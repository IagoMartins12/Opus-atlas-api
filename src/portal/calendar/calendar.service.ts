import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { LessonStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { CalendarQueryDto } from './dto/calendar-query.dto';

/** Janela máxima consultável de uma vez. */
const MAX_WINDOW_DAYS = 366;

/** Janela padrão quando o cliente não informa `to`. */
const DEFAULT_WINDOW_DAYS = 31;

/** Até onde olhar para trás atrás de aula passada sem status. */
const NEEDS_ATTENTION_DAYS = 90;

const NEEDS_ATTENTION_LIMIT = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

export type CalendarEventType = 'lesson' | 'assignment_due';

/** O outro lado do evento: para o aluno é o professor, e vice-versa. */
export interface CalendarCounterpart {
  id: string;
  userId: string;
  name: string;
  image: string | null;
  level: string | null;
}

export interface CalendarEvent {
  id: string;
  type: CalendarEventType;
  title: string;
  start: Date;
  end: Date;
  /** Prazo de tarefa marca um instante, não ocupa um intervalo na agenda. */
  allDay: boolean;
  status: string;
  counterpart: CalendarCounterpart;
  location: string | null;
  description: string | null;
  /** Detalhe específico do tipo, já recortado pelo papel de quem consulta. */
  lesson?: LessonDetail;
  assignment?: AssignmentDetail;
}

interface LessonDetail {
  duration: number;
  objectives: string[];
  topics: string[];
  techniques: string[];
  workScoreIds: string[];
  homework: string | null;
  publicNotes: string | null;
  lessonSummary: string | null;
  isRecurring: boolean;
  studentFeedback: string | null;
  canGiveFeedback: boolean;
  /** Só para o professor. */
  teacherNotes?: string | null;
}

interface AssignmentDetail {
  priority: string;
  assignmentType: string;
  isCompleted: boolean;
  isOverdue: boolean;
  progress: number | null;
  lessonId: string;
}

/** Um grupo de aulas que se sobrepõem no tempo. */
export interface CalendarConflict {
  start: Date;
  end: Date;
  lessons: Array<{
    id: string;
    title: string;
    start: Date;
    end: Date;
    studentName: string;
  }>;
}

const LESSON_SELECT = {
  id: true,
  title: true,
  description: true,
  scheduledAt: true,
  duration: true,
  status: true,
  location: true,
  objectives: true,
  topics: true,
  techniques: true,
  workScoreIds: true,
  homework: true,
  publicNotes: true,
  teacherNotes: true,
  lessonSummary: true,
  studentFeedback: true,
  isRecurring: true,
  teacher: {
    select: {
      id: true,
      userId: true,
      user: { select: { firstName: true, lastName: true, image: true } },
    },
  },
  student: {
    select: {
      id: true,
      userId: true,
      level: true,
      user: { select: { firstName: true, lastName: true, image: true } },
    },
  },
} as const;

const ASSIGNMENT_SELECT = {
  id: true,
  title: true,
  description: true,
  type: true,
  priority: true,
  status: true,
  dueDate: true,
  isCompleted: true,
  progress: true,
  student: {
    select: {
      id: true,
      userId: true,
      level: true,
      user: { select: { firstName: true, lastName: true, image: true } },
    },
  },
  lesson: {
    select: {
      id: true,
      teacher: {
        select: {
          id: true,
          userId: true,
          user: { select: { firstName: true, lastName: true, image: true } },
        },
      },
    },
  },
} as const;

type LessonRow = Prisma.LessonGetPayload<{ select: typeof LESSON_SELECT }>;
type AssignmentRow = Prisma.AssignmentGetPayload<{
  select: typeof ASSIGNMENT_SELECT;
}>;

/** Tarefa com prazo definido — a única que vira evento de calendário. */
type DatedAssignmentRow = AssignmentRow & { dueDate: Date };

const hasDueDate = (
  assignment: AssignmentRow,
): assignment is DatedAssignmentRow => assignment.dueDate !== null;

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
  ) {}

  /**
   * Monta a visão do período para aluno ou professor.
   *
   * **É só leitura.** No legado esta rota também criava aula (`POST`), movia
   * aula (`PATCH`) e gravava feedback do aluno — uma segunda implementação de
   * coisas que as rotas de aula já faziam, e com regras mais fracas: a criação
   * pelo calendário não avisava o aluno e aceitava vínculo apenas `isActive`,
   * sem exigir convite aceito. Aqui essas ações não são reimplementadas; quem
   * agenda é `POST /lessons`, quem remarca é `PATCH /lessons/:id/reschedule` e
   * quem dá feedback é `PATCH /lessons/:id/feedback`.
   */
  async getCalendar(userId: string, query: CalendarQueryDto) {
    const scope = await this.resolveScope(userId, query.as);
    const { from, to } = this.resolveWindow(query);

    const lessonWhere: Prisma.LessonWhereInput = {
      ...scope.lessonWhere,
      ...this.counterpartFilter(scope.role, query),
      scheduledAt: { gte: from, lte: to },
    };

    // As horas livres saem da agenda declarada. Sem ela, `null` — o legado
    // inventava cinco dias de oito horas e mostrava a conta como dado.
    const wantsFreeTime =
      scope.role === 'teacher' && (query.stats || query.freeSlots);

    const [lessons, assignments, needsAttention, free] = await Promise.all([
      this.prisma.lesson.findMany({
        where: lessonWhere,
        select: LESSON_SELECT,
        orderBy: { scheduledAt: 'asc' },
      }),
      this.findAssignments(scope.assignmentWhere, from, to, query),
      this.findNeedsAttention(scope.lessonWhere, from, query),
      wantsFreeTime && scope.teacher
        ? this.availability.computeFreeTime(
            scope.teacher.id,
            scope.teacher.timezone,
            from,
            to,
          )
        : null,
    ]);

    const events: CalendarEvent[] = [
      ...lessons.map((lesson) => this.toLessonEvent(lesson, scope.role)),
      // O filtro da consulta já exclui tarefa sem prazo; o predicado abaixo
      // transporta isso para o tipo, em vez de afirmar com um cast.
      ...assignments
        .filter(hasDueDate)
        .map((assignment) => this.toAssignmentEvent(assignment, scope.role)),
    ].sort((a, b) => a.start.getTime() - b.start.getTime());

    return {
      period: { from, to, role: scope.role },
      events,
      needsAttention: needsAttention.map((lesson) =>
        this.toLessonEvent(lesson, scope.role),
      ),
      metadata: this.buildMetadata(events),
      ...(query.stats
        ? {
            stats: {
              ...this.buildStats(lessons, assignments),
              ...(scope.role === 'teacher'
                ? { freeHours: free?.hours ?? null }
                : {}),
            },
          }
        : {}),
      ...(query.freeSlots && scope.role === 'teacher'
        ? { freeSlots: free?.slots ?? [] }
        : {}),
      ...(query.conflicts && scope.role === 'teacher'
        ? { conflicts: this.detectConflicts(lessons) }
        : {}),
    };
  }

  // -------------------------------------------------------------------
  // Janela
  // -------------------------------------------------------------------

  /**
   * Resolve e limita o intervalo consultado.
   *
   * O legado repassava `start` e `end` crus da query para o Prisma: sem teto,
   * `?start=1900-01-01&end=2100-01-01` carregava a agenda inteira do usuário
   * de uma vez; e uma data inválida virava `Invalid Date`, que chega ao banco
   * como erro em vez de como 400.
   */
  private resolveWindow(query: CalendarQueryDto): { from: Date; to: Date } {
    const from = query.from ? new Date(query.from) : this.startOfMonth();

    if (Number.isNaN(from.getTime())) {
      throw new BadRequestException('`from` não é uma data válida');
    }

    const to = query.to
      ? new Date(query.to)
      : new Date(from.getTime() + DEFAULT_WINDOW_DAYS * DAY_MS);

    if (Number.isNaN(to.getTime())) {
      throw new BadRequestException('`to` não é uma data válida');
    }

    if (to <= from) {
      throw new BadRequestException('`to` precisa ser posterior a `from`');
    }

    if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
      throw new BadRequestException(
        `A janela do calendário é de no máximo ${MAX_WINDOW_DAYS} dias`,
      );
    }

    return { from, to };
  }

  private async findAssignments(
    scopeWhere: Prisma.AssignmentWhereInput,
    from: Date,
    to: Date,
    query: CalendarQueryDto,
  ): Promise<AssignmentRow[]> {
    if (query.includeAssignments === false) {
      return [];
    }

    return this.prisma.assignment.findMany({
      where: { ...scopeWhere, dueDate: { gte: from, lte: to } },
      select: ASSIGNMENT_SELECT,
      orderBy: { dueDate: 'asc' },
    });
  }

  private startOfMonth(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  /**
   * Aulas que já passaram e continuam como agendadas.
   *
   * O professor precisa fechá-las (concluída, falta ou cancelada), então elas
   * aparecem fora da janela consultada. **Com piso e com teto:** o legado
   * buscava toda aula `SCHEDULED` anterior ao início do período, sem limite
   * inferior nem quantidade máxima, e ainda misturava o resultado na mesma
   * lista de eventos do período — um professor com dois anos de histórico
   * carregava tudo a cada abertura do calendário.
   */
  private async findNeedsAttention(
    scopeWhere: Prisma.LessonWhereInput,
    windowStart: Date,
    query: CalendarQueryDto,
  ): Promise<LessonRow[]> {
    if (query.includeNeedsAttention === false) {
      return [];
    }

    const floor = new Date(Date.now() - NEEDS_ATTENTION_DAYS * DAY_MS);
    const ceiling = windowStart < new Date() ? windowStart : new Date();

    if (ceiling <= floor) {
      return [];
    }

    return this.prisma.lesson.findMany({
      where: {
        ...scopeWhere,
        status: LessonStatus.SCHEDULED,
        scheduledAt: { gte: floor, lt: ceiling },
      },
      select: LESSON_SELECT,
      orderBy: { scheduledAt: 'desc' },
      take: NEEDS_ATTENTION_LIMIT,
    });
  }

  // -------------------------------------------------------------------
  // Projeção
  // -------------------------------------------------------------------

  /**
   * Não devolve cor.
   *
   * O legado calculava `backgroundColor`, `borderColor` e `textColor` em
   * hexadecimal dentro da rota. Isso é decisão de apresentação, e prendia a
   * paleta do produto ao backend: mudar o tom de "cancelada" exigia mexer na
   * API, e cada front que consumisse a rota herdava o tema de outro. A resposta
   * traz `status` e `needsAttention`; a cor é escolha de quem desenha a tela.
   */
  private toLessonEvent(
    lesson: LessonRow,
    role: 'teacher' | 'student',
  ): CalendarEvent {
    const start = lesson.scheduledAt;
    const end = new Date(start.getTime() + lesson.duration * 60_000);

    const counterpart =
      role === 'teacher'
        ? this.studentCounterpart(lesson.student)
        : this.teacherCounterpart(lesson.teacher);

    return {
      id: lesson.id,
      type: 'lesson',
      title: lesson.title,
      start,
      end,
      allDay: false,
      status: lesson.status,
      counterpart,
      location: lesson.location,
      description: lesson.description,
      lesson: {
        duration: lesson.duration,
        objectives: lesson.objectives,
        topics: lesson.topics,
        techniques: lesson.techniques,
        workScoreIds: lesson.workScoreIds,
        homework: lesson.homework,
        publicNotes: lesson.publicNotes,
        lessonSummary: lesson.lessonSummary,
        isRecurring: lesson.isRecurring,
        studentFeedback: lesson.studentFeedback,
        canGiveFeedback:
          role === 'student' &&
          lesson.status === LessonStatus.COMPLETED &&
          !lesson.studentFeedback,
        // Anotação privada do professor não vai para o aluno, aqui como nas
        // rotas de aula.
        ...(role === 'teacher' ? { teacherNotes: lesson.teacherNotes } : {}),
      },
    };
  }

  private toAssignmentEvent(
    assignment: DatedAssignmentRow,
    role: 'teacher' | 'student',
  ): CalendarEvent {
    const due = assignment.dueDate;

    const counterpart =
      role === 'teacher'
        ? this.studentCounterpart(assignment.student)
        : this.teacherCounterpart(assignment.lesson.teacher);

    return {
      id: assignment.id,
      type: 'assignment_due',
      title: assignment.title,
      start: due,
      end: due,
      allDay: true,
      status: assignment.status,
      counterpart,
      location: null,
      description: assignment.description,
      assignment: {
        priority: assignment.priority,
        assignmentType: assignment.type,
        isCompleted: assignment.isCompleted,
        isOverdue: !assignment.isCompleted && due.getTime() < Date.now(),
        progress: assignment.progress,
        lessonId: assignment.lesson.id,
      },
    };
  }

  /** `level` só existe do lado do aluno; o professor devolve `null`. */
  private studentCounterpart(student: {
    id: string;
    userId: string;
    level: string;
    user: {
      firstName: string | null;
      lastName: string | null;
      image: string | null;
    };
  }): CalendarCounterpart {
    return {
      id: student.id,
      userId: student.userId,
      name: this.fullName(student.user),
      image: student.user.image,
      level: student.level,
    };
  }

  private teacherCounterpart(teacher: {
    id: string;
    userId: string;
    user: {
      firstName: string | null;
      lastName: string | null;
      image: string | null;
    };
  }): CalendarCounterpart {
    return {
      id: teacher.id,
      userId: teacher.userId,
      name: this.fullName(teacher.user),
      image: teacher.user.image,
      level: null,
    };
  }

  private fullName(user: {
    firstName: string | null;
    lastName: string | null;
  }) {
    return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  }

  private buildMetadata(events: CalendarEvent[]) {
    const byStatus: Record<string, number> = {};

    for (const event of events) {
      byStatus[event.status] = (byStatus[event.status] ?? 0) + 1;
    }

    return {
      total: events.length,
      lessons: events.filter((event) => event.type === 'lesson').length,
      assignmentsDue: events.filter((event) => event.type === 'assignment_due')
        .length,
      byStatus,
    };
  }

  // -------------------------------------------------------------------
  // Estatísticas
  // -------------------------------------------------------------------

  /**
   * Resumo do período.
   *
   * Duas correções sobre o legado:
   *
   * 1. **A taxa de presença só considera aula que já aconteceu.** Antes o
   *    denominador era o total de eventos do período, aulas futuras incluídas,
   *    então um aluno com uma falta e oito aulas ainda por vir aparecia com 90%
   *    de presença quando o número real era 50%.
   * 2. **Não existe mais "horas livres".** O legado inventava a
   *    disponibilidade do professor — cinco dias por semana, oito horas por dia
   *    — e apresentava a sobra como se fosse dado. Enquanto não houver agenda
   *    de disponibilidade declarada, o número seria ficção com aparência de
   *    fato.
   */
  private buildStats(lessons: LessonRow[], assignments: AssignmentRow[]) {
    const now = Date.now();
    const byStatus = (status: LessonStatus) =>
      lessons.filter((lesson) => lesson.status === status).length;

    const completed = byStatus(LessonStatus.COMPLETED);
    const noShow = byStatus(LessonStatus.NO_SHOW);
    const attended = completed + noShow;

    const busyMinutes = lessons
      .filter((lesson) => lesson.status === LessonStatus.COMPLETED)
      .reduce((total, lesson) => total + lesson.duration, 0);

    return {
      totalLessons: lessons.length,
      completedLessons: completed,
      scheduledLessons: byStatus(LessonStatus.SCHEDULED),
      cancelledLessons: byStatus(LessonStatus.CANCELLED),
      noShowLessons: noShow,
      lessonHours: Math.round((busyMinutes / 60) * 10) / 10,
      // `null`, e não 100, quando nada aconteceu ainda: 100% de presença sem
      // nenhuma aula dada é um número que engana quem lê.
      attendanceRate:
        attended > 0 ? Math.round((completed / attended) * 1000) / 10 : null,
      assignmentsDue: assignments.length,
      assignmentsOverdue: assignments.filter(
        (assignment) =>
          !assignment.isCompleted &&
          assignment.dueDate !== null &&
          assignment.dueDate.getTime() < now,
      ).length,
    };
  }

  // -------------------------------------------------------------------
  // Conflitos
  // -------------------------------------------------------------------

  /**
   * Agrupa as aulas agendadas que se sobrepõem no tempo.
   *
   * Três correções sobre o legado:
   *
   * 1. **A comparação não é mais por dia do calendário.** Antes as aulas eram
   *    agrupadas por `toDateString()` e só se comparavam dentro do mesmo
   *    balde, então uma aula das 23h30 à 0h30 nunca conflitava com outra à
   *    meia-noite do dia seguinte.
   * 2. **Cada aula aparece uma vez.** O laço antigo empurrava os dois lados de
   *    cada par para a lista, então uma aula envolvida em três sobreposições
   *    saía repetida três vezes.
   * 3. **A data do grupo é a do próprio choque**, não o resultado de converter
   *    um `toDateString()` de volta para `Date`.
   */
  private detectConflicts(lessons: LessonRow[]): CalendarConflict[] {
    const scheduled = lessons
      .filter((lesson) => lesson.status === LessonStatus.SCHEDULED)
      .map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        start: lesson.scheduledAt,
        end: new Date(lesson.scheduledAt.getTime() + lesson.duration * 60_000),
        studentName: this.fullName(lesson.student.user),
      }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    const conflicts: CalendarConflict[] = [];
    let cluster: typeof scheduled = [];
    let clusterEnd = 0;

    // Varredura única sobre a lista ordenada: enquanto a próxima aula começar
    // antes do fim do grupo corrente, ela pertence ao mesmo choque.
    for (const lesson of scheduled) {
      if (cluster.length > 0 && lesson.start.getTime() < clusterEnd) {
        cluster.push(lesson);
        clusterEnd = Math.max(clusterEnd, lesson.end.getTime());
        continue;
      }

      if (cluster.length > 1) {
        conflicts.push(this.toConflict(cluster));
      }

      cluster = [lesson];
      clusterEnd = lesson.end.getTime();
    }

    if (cluster.length > 1) {
      conflicts.push(this.toConflict(cluster));
    }

    return conflicts;
  }

  private toConflict(cluster: CalendarConflict['lessons']): CalendarConflict {
    return {
      start: cluster[0].start,
      end: new Date(Math.max(...cluster.map((lesson) => lesson.end.getTime()))),
      lessons: cluster,
    };
  }

  // -------------------------------------------------------------------
  // Recorte
  // -------------------------------------------------------------------

  private counterpartFilter(
    role: 'teacher' | 'student',
    query: CalendarQueryDto,
  ): Prisma.LessonWhereInput {
    if (role === 'teacher' && query.studentId) {
      return { studentId: query.studentId };
    }

    if (role === 'student' && query.teacherId) {
      return { teacherId: query.teacherId };
    }

    return {};
  }

  private async resolveScope(userId: string, as?: 'teacher' | 'student') {
    if (as !== 'student') {
      const teacher = await this.prisma.teacher.findUnique({
        where: { userId },
        select: { id: true, timezone: true },
      });

      if (teacher) {
        return {
          role: 'teacher' as const,
          teacher,
          lessonWhere: { teacherId: teacher.id },
          assignmentWhere: {
            lesson: { is: { teacherId: teacher.id } },
          } satisfies Prisma.AssignmentWhereInput,
        };
      }

      if (as === 'teacher') {
        throw new ForbiddenException('Você não tem perfil de professor');
      }
    }

    const student = await this.prisma.student.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!student) {
      throw new ForbiddenException('Você não tem perfil de aluno');
    }

    return {
      role: 'student' as const,
      teacher: null,
      lessonWhere: { studentId: student.id },
      assignmentWhere: {
        studentId: student.id,
      } satisfies Prisma.AssignmentWhereInput,
    };
  }
}
