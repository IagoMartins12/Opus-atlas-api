import { Injectable, Logger } from '@nestjs/common';
import {
  AssignmentStatus,
  LessonStatus,
  StudentInviteStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateNotificationInput,
  NotificationsService,
} from './notifications.service';
import {
  assignmentDueSoon,
  assignmentOverdue,
  AssignmentForNotice,
  DUE_SOON_MS,
  invitePending,
  InviteForNotice,
  lessonNeedsStatus,
  lessonStartingSoon,
  lessonTomorrow,
  LessonForNotice,
  NEEDS_STATUS_AFTER_MS,
  NEEDS_STATUS_UNTIL_MS,
  STARTING_SOON_MS,
  TOMORROW_WINDOW_MS,
} from './automatic-rules';

/** Teto por regra numa varredura, para uma base grande não virar um job eterno. */
const MAX_PER_RULE = 2_000;

const LESSON_SELECT = {
  id: true,
  title: true,
  scheduledAt: true,
  teacher: {
    select: { user: { select: { id: true, firstName: true, lastName: true } } },
  },
  student: {
    select: { user: { select: { id: true, firstName: true, lastName: true } } },
  },
} as const;

export interface SweepResult {
  /** Quantas notificações foram criadas, por regra. */
  created: Record<string, number>;
  total: number;
  durationMs: number;
}

const fullName = (user: {
  firstName: string | null;
  lastName: string | null;
}) =>
  [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
  'sem nome';

/**
 * Varredura das notificações automáticas.
 *
 * **A mudança estrutural é quem pergunta.** No legado, as notificações
 * automáticas nasciam dentro de `POST /notifications/check`, chamada pelo
 * navegador do próprio usuário: só existia notificação para quem estava com o
 * portal aberto no minuto certo. Aqui a varredura roda no worker, sobre a base
 * inteira, e o aviso de "sua aula começa em 30 minutos" chega a quem não estava
 * olhando — que é o único caso em que ele serve para alguma coisa.
 *
 * **O bug que isso enterra:** a rota do professor consultava
 * `lesson.findMany({ where: { teacherId: session.user.id } })`. Mas
 * `Lesson.teacherId` referencia `Teacher.id` — o id do **perfil**, não o do
 * usuário. A consulta não casava com nada, sempre. Professores nunca receberam
 * uma única notificação automática de aula, e nada no sistema acusava: a lista
 * simplesmente vinha vazia. A rota do aluno, escrita separadamente, resolvia o
 * perfil antes (`student.findUnique({ where: { userId } })`) e funcionava — a
 * assimetria entre as duas é que denuncia o erro.
 */
@Injectable()
export class NotificationSweepService {
  private readonly logger = new Logger(NotificationSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async sweep(): Promise<SweepResult> {
    const startedAt = Date.now();
    const now = new Date();

    const created: Record<string, number> = {};

    // Funções, não promessas já criadas: se a primeira regra falhar, as demais
    // nem começam — em vez de ficarem pendentes e virarem rejeição sem dono.
    const rules: [string, () => Promise<CreateNotificationInput[]>][] = [
      ['aulaComecando', () => this.startingSoon(now)],
      ['aulaAmanha', () => this.tomorrow(now)],
      ['aulaSemStatus', () => this.needsStatus(now)],
      ['tarefaVencendo', () => this.dueSoon(now)],
      ['tarefaAtrasada', () => this.overdue(now)],
      ['convitePendente', () => this.pendingInvites(now)],
    ];

    let total = 0;

    for (const [name, work] of rules) {
      const inputs = await work();

      // `notify()` descarta o que já existe por `uniqueHash`, então o número
      // aqui é de notificações *candidatas*, não de linhas novas. O que
      // interessa operacionalmente é o volume que a regra produz.
      await this.notifications.notifyMany(inputs);

      created[name] = inputs.length;
      total += inputs.length;
    }

    const result: SweepResult = {
      created,
      total,
      durationMs: Date.now() - startedAt,
    };

    this.logger.log(
      `Varredura de notificações: ${total} candidatas em ${result.durationMs}ms — ` +
        JSON.stringify(created),
    );

    return result;
  }

  // -------------------------------------------------------------------

  private async startingSoon(now: Date): Promise<CreateNotificationInput[]> {
    const lessons = await this.prisma.lesson.findMany({
      where: {
        status: LessonStatus.SCHEDULED,
        scheduledAt: {
          gte: now,
          lte: new Date(now.getTime() + STARTING_SOON_MS),
        },
      },
      select: LESSON_SELECT,
      take: MAX_PER_RULE,
    });

    return lessons.flatMap((lesson) =>
      lessonStartingSoon(this.toNotice(lesson)),
    );
  }

  /**
   * Aulas de amanhã.
   *
   * A janela começa onde a de "começa logo" termina, para a mesma aula não
   * gerar os dois avisos ao mesmo tempo meia hora antes.
   */
  private async tomorrow(now: Date): Promise<CreateNotificationInput[]> {
    const lessons = await this.prisma.lesson.findMany({
      where: {
        status: LessonStatus.SCHEDULED,
        scheduledAt: {
          gt: new Date(now.getTime() + STARTING_SOON_MS),
          lte: new Date(now.getTime() + TOMORROW_WINDOW_MS),
        },
      },
      select: LESSON_SELECT,
      take: MAX_PER_RULE,
    });

    return lessons.flatMap((lesson) => lessonTomorrow(this.toNotice(lesson)));
  }

  private async needsStatus(now: Date): Promise<CreateNotificationInput[]> {
    const lessons = await this.prisma.lesson.findMany({
      where: {
        status: LessonStatus.SCHEDULED,
        scheduledAt: {
          lt: new Date(now.getTime() - NEEDS_STATUS_AFTER_MS),
          gte: new Date(now.getTime() - NEEDS_STATUS_UNTIL_MS),
        },
      },
      select: LESSON_SELECT,
      take: MAX_PER_RULE,
    });

    return lessons.flatMap((lesson) =>
      lessonNeedsStatus(this.toNotice(lesson)),
    );
  }

  private async dueSoon(now: Date): Promise<CreateNotificationInput[]> {
    const assignments = await this.prisma.assignment.findMany({
      where: {
        status: {
          in: [AssignmentStatus.PENDING, AssignmentStatus.IN_PROGRESS],
        },
        dueDate: { gte: now, lte: new Date(now.getTime() + DUE_SOON_MS) },
      },
      select: this.assignmentSelect(),
      take: MAX_PER_RULE,
    });

    return assignments.flatMap((assignment) =>
      assignmentDueSoon(this.toAssignmentNotice(assignment)),
    );
  }

  private async overdue(now: Date): Promise<CreateNotificationInput[]> {
    const assignments = await this.prisma.assignment.findMany({
      where: {
        status: {
          in: [AssignmentStatus.PENDING, AssignmentStatus.IN_PROGRESS],
        },
        // `not: null`: no MongoDB, `null` ordena antes de qualquer data, e
        // tarefa sem prazo recebia aviso de atraso.
        dueDate: { lt: now, not: null },
      },
      select: this.assignmentSelect(),
      take: MAX_PER_RULE,
    });

    return assignments.flatMap((assignment) =>
      assignmentOverdue(this.toAssignmentNotice(assignment)),
    );
  }

  private async pendingInvites(now: Date): Promise<CreateNotificationInput[]> {
    const invites = await this.prisma.teacherStudent.findMany({
      where: {
        inviteStatus: StudentInviteStatus.PENDING,
        createdAt: { gte: new Date(now.getTime() - NEEDS_STATUS_UNTIL_MS) },
      },
      select: {
        id: true,
        createdAt: true,
        teacher: { select: { user: { select: { id: true } } } },
        student: {
          select: {
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
      take: MAX_PER_RULE,
    });

    return invites.flatMap((invite) =>
      invitePending({
        id: invite.id,
        createdAt: invite.createdAt,
        teacherUserId: invite.teacher.user.id,
        studentName: fullName(invite.student.user),
      } satisfies InviteForNotice),
    );
  }

  // -------------------------------------------------------------------

  private assignmentSelect() {
    return {
      id: true,
      title: true,
      dueDate: true,
      student: { select: { user: { select: { id: true } } } },
      lesson: {
        select: {
          teacher: {
            select: {
              user: { select: { firstName: true, lastName: true } },
            },
          },
        },
      },
    } as const;
  }

  private toNotice(lesson: {
    id: string;
    title: string;
    scheduledAt: Date;
    teacher: {
      user: { id: string; firstName: string | null; lastName: string | null };
    };
    student: {
      user: { id: string; firstName: string | null; lastName: string | null };
    };
  }): LessonForNotice {
    return {
      id: lesson.id,
      title: lesson.title,
      scheduledAt: lesson.scheduledAt,
      teacherUserId: lesson.teacher.user.id,
      studentUserId: lesson.student.user.id,
      teacherName: fullName(lesson.teacher.user),
      studentName: fullName(lesson.student.user),
    };
  }

  private toAssignmentNotice(assignment: {
    id: string;
    title: string;
    dueDate: Date | null;
    student: { user: { id: string } };
    lesson: {
      teacher: { user: { firstName: string | null; lastName: string | null } };
    };
  }): AssignmentForNotice {
    return {
      id: assignment.id,
      title: assignment.title,
      // A consulta filtra por `dueDate`, então aqui ele existe; o `??` é só
      // para o tipo, já que o campo é opcional no schema.
      dueDate: assignment.dueDate ?? new Date(),
      studentUserId: assignment.student.user.id,
      teacherName: fullName(assignment.lesson.teacher.user),
    };
  }
}
