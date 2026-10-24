import { escapeRegex } from '../../common/utils/regex.util';
import { escapeHtml } from '../../common/utils/html.util';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isMongoId } from 'class-validator';
import {
  LessonRequestStatus,
  LessonStatus,
  NotificationPriority,
  NotificationType,
  Prisma,
  SchoolActivityAction,
  StudentInviteStatus,
  TokenType,
} from '@prisma/client';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace } from '../../common/cache/cache-keys';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionsService } from '../../billing/services/subscriptions.service';
import { UserTokenService } from '../../auth/user-token.service';
import { MailService } from '../../mail/mail.service';
import { errorMessage } from '../../common/utils/error.util';
import { NotificationsService } from '../notifications/notifications.service';
import { SchoolActivitiesService } from '../school-activities/school-activities.service';
import { InviteStudentDto } from './dto/invite-student.dto';
import { ListStudentsQueryDto } from './dto/list-students-query.dto';
import { UpdateRelationshipDto } from './dto/update-relationship.dto';

interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

const USER_SUMMARY_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  image: true,
} as const;

const STUDENT_ROW_INCLUDE = {
  student: {
    select: {
      id: true,
      userId: true,
      level: true,
      mainInstrument: true,
      status: true,
      totalLessonsAttended: true,
      completedAssignments: true,
      totalAssignments: true,
      currentStreak: true,
      lastActiveAt: true,
      user: { select: USER_SUMMARY_SELECT },
    },
  },
} as const;

type StudentRow = Prisma.TeacherStudentGetPayload<{
  include: typeof STUDENT_ROW_INCLUDE;
}>;

/** Os números de um aluno na tabela de alunos. */
export interface StudentStats {
  nextLessonAt: Date | null;
  lastLessonAt: Date | null;
  /** Só sobre aula que já aconteceu; `null` sem nenhuma. */
  attendanceRate: number | null;
  practiceMinutes7d: number;
  practiceGoalMinutes: number | null;
  openAssignments: number;
  overdueAssignments: number;
}

@Injectable()
export class RelationshipsService {
  private readonly logger = new Logger(RelationshipsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: UserTokenService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly configService: ConfigService,
    private readonly subscriptions: SubscriptionsService,
    private readonly cache: AppCacheService,
    private readonly activities: SchoolActivitiesService,
  ) {}

  // -------------------------------------------------------------------
  // Convite
  // -------------------------------------------------------------------

  /**
   * Convida um aluno.
   *
   * O vínculo nasce `PENDING` e só passa a valer quando o aluno aceita — o
   * professor não consegue se vincular a alguém à revelia.
   */
  async inviteStudent(
    teacherUserId: string,
    dto: InviteStudentDto,
    context: RequestContext,
  ) {
    if (dto.studentUserId === teacherUserId) {
      throw new BadRequestException(
        'Não é possível convidar a si mesmo como aluno',
      );
    }

    const teacher = await this.requireTeacherProfile(teacherUserId);

    await this.assertWithinStudentLimit(teacherUserId, teacher.id);

    const studentUser = await this.prisma.user.findUnique({
      where: { id: dto.studentUserId },
      select: { ...USER_SUMMARY_SELECT, isStudent: true },
    });

    if (!studentUser) {
      throw new NotFoundException('Usuário não encontrado');
    }

    // O perfil de aluno é criado sob demanda: quem recebe o primeiro convite
    // pode nunca ter marcado que é aluno.
    const student = await this.prisma.student.upsert({
      where: { userId: dto.studentUserId },
      update: {},
      create: { userId: dto.studentUserId },
    });

    const existing = await this.prisma.teacherStudent.findFirst({
      where: { teacherId: teacher.id, studentId: student.id },
    });

    if (
      existing?.inviteStatus === StudentInviteStatus.ACCEPTED &&
      existing.isActive
    ) {
      throw new ConflictException('Este aluno já está vinculado a você');
    }

    if (existing?.inviteStatus === StudentInviteStatus.PENDING) {
      throw new ConflictException(
        'Já existe um convite pendente para este aluno',
      );
    }

    const data = this.buildRelationshipData(dto);

    // Um vínculo recusado ou encerrado é reaproveitado em vez de duplicado:
    // o histórico de aulas e tarefas fica preso ao id do vínculo.
    const relationship = existing
      ? await this.prisma.teacherStudent.update({
          where: { id: existing.id },
          data: {
            ...data,
            isActive: true,
            endDate: null,
            inviteStatus: StudentInviteStatus.PENDING,
            inviteAcceptedAt: null,
            inviteDeclinedAt: null,
            startDate: new Date(),
          },
        })
      : await this.prisma.teacherStudent.create({
          data: {
            ...data,
            teacherId: teacher.id,
            studentId: student.id,
            inviteStatus: StudentInviteStatus.PENDING,
          },
        });

    // "Evitar verificação" (04/10/2026): só existe para conta que já existe —
    // que é o único caso deste convite, feito por id de usuário. O vínculo
    // nasce aceito, sem e-mail; o aluno recebe o aviso no portal dizendo quem
    // o adicionou e que pode sair da turma.
    const studentName =
      [studentUser.firstName, studentUser.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() ||
      studentUser.email ||
      'aluno';
    await this.activities.record({
      userId: teacherUserId,
      userType: 'teacher',
      action: SchoolActivityAction.STUDENT_ADDED,
      entityType: 'student',
      entityId: student.id,
      entityName: studentName,
      title: dto.skipVerification
        ? `Adicionou ${studentName} à turma`
        : `Convidou ${studentName}`,
    });

    if (dto.skipVerification) {
      const activated = await this.activate(
        {
          id: relationship.id,
          teacherId: teacher.id,
          studentId: student.id,
          teacher: { userId: teacherUserId, user: teacher.user },
          student: { userId: dto.studentUserId, user: studentUser },
        },
        'added',
      );
      return {
        relationshipId: activated.relationshipId,
        inviteStatus: StudentInviteStatus.ACCEPTED,
        student: studentUser,
      };
    }

    await this.sendInvitation(
      relationship.id,
      teacher.user,
      studentUser,
      dto.studentUserId,
      context,
    );

    return {
      relationshipId: relationship.id,
      inviteStatus: relationship.inviteStatus,
      student: studentUser,
    };
  }

  /**
   * Reenvia o convite pendente.
   *
   * Emite tokens novos: os anteriores continuam válidos por 30 dias, e deixar
   * dois pares de links vivos deixaria o aluno com botões que apontam para
   * estados diferentes.
   */
  async resendInvitation(
    teacherUserId: string,
    relationshipId: string,
    context: RequestContext,
  ) {
    const teacher = await this.requireTeacherProfile(teacherUserId);
    const relationship = await this.requireRelationship(
      relationshipId,
      teacher.id,
    );

    if (relationship.inviteStatus !== StudentInviteStatus.PENDING) {
      throw new BadRequestException(
        'Só é possível reenviar convite que ainda está pendente',
      );
    }

    await this.sendInvitation(
      relationship.id,
      teacher.user,
      relationship.student.user,
      relationship.student.userId,
      context,
      { revokePrevious: true },
    );

    return { relationshipId: relationship.id, resent: true };
  }

  // -------------------------------------------------------------------
  // Resposta do aluno
  // -------------------------------------------------------------------

  async acceptInvitation(token: string) {
    const relationship = await this.consumeInvitationToken(
      token,
      TokenType.STUDENT_INVITATION_ACCEPT,
    );
    return this.activate(relationship, 'accepted');
  }

  /**
   * O aluno aceita de dentro do portal, logado — a tela de convite pendente
   * (04/10/2026). Mesmo efeito do link do e-mail; o link deixa de funcionar
   * porque o vínculo já não está pendente.
   */
  async acceptAsStudent(studentUserId: string, relationshipId: string) {
    const relationship = await this.requirePendingOfStudent(
      studentUserId,
      relationshipId,
    );
    await this.assertWithinStudentLimit(
      relationship.teacher.userId,
      relationship.teacherId,
    );
    return this.activate(relationship, 'accepted');
  }

  async declineAsStudent(studentUserId: string, relationshipId: string) {
    const relationship = await this.requirePendingOfStudent(
      studentUserId,
      relationshipId,
    );
    return this.decline(relationship);
  }

  /**
   * O aluno sai da turma (04/10/2026). Mesmo efeito de o professor encerrar:
   * as aulas futuras e os pedidos pendentes são cancelados (sem vínculo não
   * há aula, e elas virariam "sem desfecho"), e o histórico continua dos dois.
   */
  async leaveAsStudent(studentUserId: string, relationshipId: string) {
    const relationship = await this.prisma.teacherStudent.findFirst({
      where: {
        id: relationshipId,
        isActive: true,
        inviteStatus: StudentInviteStatus.ACCEPTED,
        student: { is: { userId: studentUserId } },
      },
      include: {
        teacher: {
          select: {
            id: true,
            userId: true,
            user: { select: USER_SUMMARY_SELECT },
          },
        },
        student: {
          select: { userId: true, user: { select: USER_SUMMARY_SELECT } },
        },
      },
    });
    if (!relationship) throw new NotFoundException('Turma não encontrada');

    await this.prisma.$transaction([
      this.prisma.teacherStudent.update({
        where: { id: relationshipId },
        data: {
          isActive: false,
          endDate: new Date(),
          pauseReason: 'Saída do aluno',
        },
      }),
      this.prisma.teacher.update({
        where: { id: relationship.teacher.id },
        data: { totalStudents: { decrement: 1 } },
      }),
      ...this.cancelFutureOf(relationship.teacher.id, relationship.studentId),
    ]);
    await this.cache.invalidateMany([CacheNamespace.TEACHERS]);
    await this.subscriptions.updateUserPlanCache(studentUserId);

    await this.notifications.notify({
      userId: relationship.teacher.userId,
      type: NotificationType.STUDENT_DECLINED_INVITE,
      priority: NotificationPriority.MEDIUM,
      title: 'Aluno saiu da turma',
      message: `${this.displayName(relationship.student.user)} saiu da sua turma. O histórico fica guardado.`,
      relatedEntityType: 'teacherStudent',
      relatedEntityId: relationshipId,
    });

    const teacherName = this.displayName(relationship.teacher.user);
    await this.activities.record({
      userId: studentUserId,
      userType: 'student',
      action: SchoolActivityAction.TEACHER_LEFT,
      entityType: 'teacher',
      entityId: relationshipId,
      entityName: teacherName,
      title: `Saiu da turma de ${teacherName}`,
    });
  }

  /**
   * Ativa o vínculo — o único lugar que faz isso, para os quatro caminhos
   * (link do e-mail, aceite no portal, convite sem verificação).
   */
  private async activate(
    relationship: {
      id: string;
      teacherId: string;
      studentId: string;
      teacher: {
        userId: string;
        user: { firstName: string | null; lastName: string | null };
      };
      student: {
        userId: string;
        user: { firstName: string | null; lastName: string | null };
      };
    },
    how: 'accepted' | 'added',
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.teacherStudent.update({
        where: { id: relationship.id },
        data: {
          inviteStatus: StudentInviteStatus.ACCEPTED,
          inviteAcceptedAt: new Date(),
          isActive: true,
        },
      });

      // O contador é mantido no perfil do professor para o painel não precisar
      // recontar o vínculo a cada carregamento.
      await tx.teacher.update({
        where: { id: relationship.teacherId },
        data: { totalStudents: { increment: 1 } },
      });

      await tx.user.update({
        where: { id: relationship.student.userId },
        data: { isStudent: true },
      });

      return result;
    });

    // O total de alunos aparece no diretório público de professores.
    await this.cache.invalidateMany([CacheNamespace.TEACHERS]);
    // Aluno de professor Maestro ganha o Plus enquanto o vínculo durar.
    await this.subscriptions.updateUserPlanCache(relationship.student.userId);

    const studentName = this.displayName(relationship.student.user);
    const teacherName = this.displayName(relationship.teacher.user);

    if (how === 'accepted') {
      await this.activities.record({
        userId: relationship.student.userId,
        userType: 'student',
        action: SchoolActivityAction.INVITE_ACCEPTED,
        entityType: 'teacher',
        entityId: relationship.id,
        entityName: teacherName,
        title: `Aceitou o convite de ${teacherName}`,
      });

      await this.notifications.notify({
        userId: relationship.teacher.userId,
        type: NotificationType.STUDENT_ACCEPTED_INVITE,
        priority: NotificationPriority.MEDIUM,
        title: 'Convite aceito',
        message: `${studentName} aceitou seu convite e agora é seu aluno.`,
        actionText: 'Ver aluno',
        actionUrl: `/teacher/students/${relationship.studentId}`,
        relatedEntityType: 'teacherStudent',
        relatedEntityId: relationship.id,
      });
    }

    await this.notifications.notify({
      userId: relationship.student.userId,
      type:
        how === 'added'
          ? NotificationType.STUDENT_ADDED_BY_TEACHER
          : NotificationType.WELCOME_NEW_STUDENT,
      priority: NotificationPriority.MEDIUM,
      title:
        how === 'added'
          ? `${teacherName} adicionou você como aluno`
          : 'Bem-vindo ao portal do aluno',
      message:
        how === 'added'
          ? `Você agora é aluno de ${teacherName}. Se não reconhece, dá para sair da turma no Perfil do portal.`
          : `Você agora é aluno de ${teacherName}.`,
      actionText: 'Abrir portal',
      actionUrl: '/student',
      relatedEntityType: 'teacherStudent',
      relatedEntityId: relationship.id,
    });

    return {
      accepted: true,
      relationshipId: updated.id,
      teacherName,
    };
  }

  private async requirePendingOfStudent(
    studentUserId: string,
    relationshipId: string,
  ) {
    const relationship = await this.prisma.teacherStudent.findFirst({
      where: {
        id: relationshipId,
        inviteStatus: StudentInviteStatus.PENDING,
        student: { is: { userId: studentUserId } },
      },
      include: {
        teacher: {
          select: {
            id: true,
            userId: true,
            user: { select: USER_SUMMARY_SELECT },
          },
        },
        student: {
          select: {
            id: true,
            userId: true,
            user: { select: USER_SUMMARY_SELECT },
          },
        },
      },
    });
    if (!relationship) throw new NotFoundException('Convite não encontrado');
    return relationship;
  }

  async declineInvitation(token: string) {
    const relationship = await this.consumeInvitationToken(
      token,
      TokenType.STUDENT_INVITATION_DECLINE,
    );
    return this.decline(relationship);
  }

  private async decline(relationship: {
    id: string;
    teacher: {
      userId: string;
      user: { firstName: string | null; lastName: string | null };
    };
    student: {
      userId: string;
      user: { firstName: string | null; lastName: string | null };
    };
  }) {
    await this.prisma.teacherStudent.update({
      where: { id: relationship.id },
      data: {
        inviteStatus: StudentInviteStatus.DECLINED,
        inviteDeclinedAt: new Date(),
        isActive: false,
      },
    });

    await this.notifications.notify({
      userId: relationship.teacher.userId,
      type: NotificationType.STUDENT_DECLINED_INVITE,
      priority: NotificationPriority.LOW,
      title: 'Convite recusado',
      message: `${this.displayName(relationship.student.user)} recusou seu convite.`,
      relatedEntityType: 'teacherStudent',
      relatedEntityId: relationship.id,
    });

    const teacherName = this.displayName(relationship.teacher.user);
    await this.activities.record({
      userId: relationship.student.userId,
      userType: 'student',
      action: SchoolActivityAction.INVITE_DECLINED,
      entityType: 'teacher',
      entityId: relationship.id,
      entityName: teacherName,
      title: `Recusou o convite de ${teacherName}`,
    });

    return {
      declined: true,
      teacherName: this.displayName(relationship.teacher.user),
    };
  }

  // -------------------------------------------------------------------
  // Consulta e manutenção
  // -------------------------------------------------------------------

  /** Alunos do professor, com filtro por situação do convite e busca por nome. */
  async listStudents(teacherUserId: string, query: ListStudentsQueryDto) {
    const teacher = await this.requireTeacherProfile(teacherUserId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.TeacherStudentWhereInput = {
      teacherId: teacher.id,
      ...(query.onlyActive === false ? {} : { isActive: true }),
      ...(query.inviteStatus ? { inviteStatus: query.inviteStatus } : {}),
      ...(query.q
        ? {
            student: {
              user: {
                OR: [
                  {
                    firstName: {
                      contains: escapeRegex(query.q),
                      mode: 'insensitive',
                    },
                  },
                  {
                    lastName: {
                      contains: escapeRegex(query.q),
                      mode: 'insensitive',
                    },
                  },
                  {
                    email: {
                      contains: escapeRegex(query.q),
                      mode: 'insensitive',
                    },
                  },
                ],
              },
            },
          }
        : {}),
    };

    const [relationships, total] = await Promise.all([
      this.prisma.teacherStudent.findMany({
        where,
        include: STUDENT_ROW_INCLUDE,
        orderBy: [{ inviteStatus: 'asc' }, { startDate: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.teacherStudent.count({ where }),
    ]);

    const stats = await this.studentStats(
      teacher.id,
      relationships
        .filter((r) => r.inviteStatus === StudentInviteStatus.ACCEPTED)
        .map((r) => r.student.id),
    );

    return {
      students: relationships.map((relationship) =>
        this.toStudentRow(relationship, stats.get(relationship.student.id)),
      ),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Um aluno do professor, para a página do aluno: o vínculo mais recente
   * (ativo, pendente ou encerrado) e os mesmos números da tabela. O legado
   * buscava todos os vínculos para achar um.
   */
  async getStudent(teacherUserId: string, studentId: string) {
    const teacher = await this.requireTeacherProfile(teacherUserId);
    const relationship = isMongoId(studentId)
      ? await this.prisma.teacherStudent.findFirst({
          // Avisos antigos apontavam para o id de usuário do aluno.
          where: {
            teacherId: teacher.id,
            OR: [{ studentId }, { student: { is: { userId: studentId } } }],
          },
          include: STUDENT_ROW_INCLUDE,
          orderBy: [{ isActive: 'desc' }, { startDate: 'desc' }],
        })
      : null;

    if (!relationship) {
      throw new NotFoundException('Aluno não encontrado');
    }

    const profileId = relationship.student.id;
    const stats =
      relationship.inviteStatus === StudentInviteStatus.ACCEPTED
        ? await this.studentStats(teacher.id, [profileId])
        : new Map<string, StudentStats>();

    return this.toStudentRow(relationship, stats.get(profileId));
  }

  private toStudentRow(relationship: StudentRow, stats?: StudentStats) {
    return {
      stats: stats ?? null,
      relationshipId: relationship.id,
      inviteStatus: relationship.inviteStatus,
      isActive: relationship.isActive,
      startDate: relationship.startDate,
      endDate: relationship.endDate,
      maxLessonsPerWeek: relationship.maxLessonsPerWeek,
      lessonDuration: relationship.lessonDuration,
      preferredDays: relationship.preferredDays,
      preferredTimes: relationship.preferredTimes,
      currentFocus: relationship.currentFocus,
      learningPlan: relationship.learningPlan,
      nextGoals: relationship.nextGoals,
      teacherNotes: relationship.teacherNotes,
      totalLessons: relationship.totalLessons,
      completedLessons: relationship.completedLessons,
      student: relationship.student,
    };
  }

  /**
   * Os números da tabela de alunos (04/10/2026), em lote para a página:
   * próxima e última aula, presença (só sobre aula que já aconteceu — "sem
   * dado" não é 0%), prática dos últimos 7 dias contra a meta e tarefas
   * abertas e atrasadas. Quatro consultas, seja qual for o tamanho da página.
   */
  private async studentStats(teacherId: string, studentIds: string[]) {
    const result = new Map<string, StudentStats>();
    if (studentIds.length === 0) return result;

    const now = new Date();
    const [lessons, practice, goals, assignments] = await Promise.all([
      this.prisma.lesson.findMany({
        where: {
          teacherId,
          studentId: { in: studentIds },
          scheduledAt: { gte: new Date(now.getTime() - 365 * 864e5) },
          status: { not: LessonStatus.CANCELLED },
        },
        select: { studentId: true, scheduledAt: true, status: true },
        orderBy: { scheduledAt: 'asc' },
        take: 5000,
      }),
      this.prisma.practiceLog.groupBy({
        by: ['studentId'],
        where: {
          studentId: { in: studentIds },
          practicedAt: { gte: new Date(now.getTime() - 7 * 864e5), lte: now },
        },
        _sum: { minutes: true },
      }),
      this.prisma.student.findMany({
        where: { id: { in: studentIds } },
        select: { id: true, practiceTime: true },
      }),
      this.prisma.assignment.findMany({
        where: {
          studentId: { in: studentIds },
          isCompleted: false,
          lesson: { is: { teacherId } },
        },
        select: { studentId: true, dueDate: true },
        take: 5000,
      }),
    ]);

    for (const id of studentIds) {
      const own = lessons.filter((l) => l.studentId === id);
      const past = own.filter((l) => l.scheduledAt < now);
      const attended = past.filter(
        (l) => l.status === LessonStatus.COMPLETED,
      ).length;
      const missed = past.filter(
        (l) => l.status === LessonStatus.NO_SHOW,
      ).length;
      const open = assignments.filter((a) => a.studentId === id);
      result.set(id, {
        nextLessonAt:
          own.find(
            (l) => l.scheduledAt >= now && l.status === LessonStatus.SCHEDULED,
          )?.scheduledAt ?? null,
        lastLessonAt: past.length ? past[past.length - 1].scheduledAt : null,
        attendanceRate:
          attended + missed > 0
            ? Math.round((attended / (attended + missed)) * 100)
            : null,
        practiceMinutes7d:
          practice.find((p) => p.studentId === id)?._sum.minutes ?? 0,
        practiceGoalMinutes:
          goals.find((g) => g.id === id)?.practiceTime ?? null,
        openAssignments: open.length,
        overdueAssignments: open.filter((a) => a.dueDate && a.dueDate < now)
          .length,
      });
    }

    return result;
  }

  /**
   * Busca usuários que ainda não são alunos deste professor.
   *
   * Serve ao formulário de convite. Devolve o mínimo necessário — nome, e-mail
   * e foto — porque é uma busca sobre a base inteira de usuários, e qualquer
   * campo a mais aqui vira exposição de dado de terceiros.
   */
  async searchInvitableUsers(teacherUserId: string, term: string) {
    const teacher = await this.requireTeacherProfile(teacherUserId);

    if (term.trim().length < 3) {
      throw new BadRequestException(
        'Informe ao menos 3 caracteres para buscar',
      );
    }

    const linked = await this.prisma.teacherStudent.findMany({
      where: { teacherId: teacher.id },
      select: { student: { select: { userId: true } } },
    });

    const excludedUserIds = [
      teacherUserId,
      ...linked.map((relationship) => relationship.student.userId),
    ];

    const users = await this.prisma.user.findMany({
      where: {
        id: { notIn: excludedUserIds },
        OR: [
          { firstName: { contains: escapeRegex(term), mode: 'insensitive' } },
          { lastName: { contains: escapeRegex(term), mode: 'insensitive' } },
          { email: { equals: escapeRegex(term), mode: 'insensitive' } },
        ],
      },
      select: USER_SUMMARY_SELECT,
      take: 10,
      orderBy: { firstName: 'asc' },
    });

    return { users };
  }

  /** Vínculos do aluno: com quais professores ele estuda. */
  async listTeachers(studentUserId: string) {
    const student = await this.prisma.student.findUnique({
      where: { userId: studentUserId },
      select: { id: true },
    });

    if (!student) {
      return { teachers: [], invitations: [], past: [] };
    }

    // Uma consulta, três listas: com quem estuda, convites pendentes e turmas
    // que acabaram — o que a tela de convite e a de orientação mostram.
    const all = await this.prisma.teacherStudent.findMany({
      where: { studentId: student.id },
      include: {
        teacher: {
          select: {
            id: true,
            userId: true,
            bio: true,
            specialties: true,
            instruments: true,
            user: { select: USER_SUMMARY_SELECT },
          },
        },
      },
      orderBy: { startDate: 'desc' },
    });
    const relationships = all.filter(
      (r) => r.inviteStatus === StudentInviteStatus.ACCEPTED && r.isActive,
    );
    const INVITE_DAYS = 30;

    return {
      invitations: all
        .filter((r) => r.inviteStatus === StudentInviteStatus.PENDING)
        .map((r) => ({
          relationshipId: r.id,
          invitedAt: r.startDate,
          expiresAt: new Date(r.startDate.getTime() + INVITE_DAYS * 86_400_000),
          teacher: r.teacher,
        })),
      past: all
        .filter(
          (r) => r.inviteStatus === StudentInviteStatus.ACCEPTED && !r.isActive,
        )
        .map((r) => ({
          relationshipId: r.id,
          startDate: r.startDate,
          endDate: r.endDate,
          totalLessons: r.totalLessons,
          teacher: r.teacher,
        })),
      teachers: relationships.map((relationship) => ({
        relationshipId: relationship.id,
        startDate: relationship.startDate,
        lessonDuration: relationship.lessonDuration,
        maxLessonsPerWeek: relationship.maxLessonsPerWeek,
        currentFocus: relationship.currentFocus,
        learningPlan: relationship.learningPlan,
        teacher: relationship.teacher,
      })),
    };
  }

  async updateRelationship(
    teacherUserId: string,
    relationshipId: string,
    dto: UpdateRelationshipDto,
  ) {
    const teacher = await this.requireTeacherProfile(teacherUserId);
    await this.requireRelationship(relationshipId, teacher.id);

    return this.prisma.teacherStudent.update({
      where: { id: relationshipId },
      data: this.buildRelationshipData(dto),
    });
  }

  /**
   * Encerra o vínculo.
   *
   * O registro não é apagado: aulas, tarefas e relatórios apontam para ele, e
   * removê-lo levaria junto o histórico das duas partes.
   */
  async endRelationship(
    teacherUserId: string,
    relationshipId: string,
    reason?: string,
  ): Promise<void> {
    const teacher = await this.requireTeacherProfile(teacherUserId);
    const relationship = await this.requireRelationship(
      relationshipId,
      teacher.id,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.teacherStudent.update({
        where: { id: relationshipId },
        data: { isActive: false, endDate: new Date(), pauseReason: reason },
      });

      if (relationship.inviteStatus === StudentInviteStatus.ACCEPTED) {
        await tx.teacher.update({
          where: { id: teacher.id },
          data: { totalStudents: { decrement: 1 } },
        });

        // Sem vínculo não há aula: as futuras saem da agenda dos dois (antes
        // ficavam marcadas e viravam "sem desfecho"). As que já passaram ficam.
        await Promise.all(
          this.cancelFutureOf(teacher.id, relationship.studentId, tx),
        );
      }
    });

    await this.cache.invalidateMany([CacheNamespace.TEACHERS]);

    // Sem vínculo, sai o Plus que vinha do professor (quem paga segue pagando).
    const student = await this.prisma.student.findUnique({
      where: { id: relationship.studentId },
      select: { userId: true },
    });
    if (student) await this.subscriptions.updateUserPlanCache(student.userId);
  }

  // -------------------------------------------------------------------
  // Apoio
  // -------------------------------------------------------------------

  /**
   * Copia para o Prisma só os campos que vieram no DTO.
   *
   * O tipo é o de criação porque ele também serve para atualização — enviar
   * apenas os campos presentes preserva o que o professor não tocou.
   */
  private buildRelationshipData(
    dto: InviteStudentDto | UpdateRelationshipDto,
  ): Partial<Prisma.TeacherStudentUncheckedCreateInput> {
    const data: Partial<Prisma.TeacherStudentUncheckedCreateInput> = {};

    if (dto.maxLessonsPerWeek !== undefined)
      data.maxLessonsPerWeek = dto.maxLessonsPerWeek;
    if (dto.lessonDuration !== undefined)
      data.lessonDuration = dto.lessonDuration;
    if (dto.preferredDays !== undefined) data.preferredDays = dto.preferredDays;
    if (dto.preferredTimes !== undefined)
      data.preferredTimes = dto.preferredTimes;
    if (dto.learningPlan !== undefined) data.learningPlan = dto.learningPlan;
    if (dto.currentFocus !== undefined) data.currentFocus = dto.currentFocus;
    if (dto.nextGoals !== undefined) data.nextGoals = dto.nextGoals;
    if (dto.teacherNotes !== undefined) data.teacherNotes = dto.teacherNotes;
    if (dto.homeworkFrequency !== undefined)
      data.homeworkFrequency = dto.homeworkFrequency;
    if (dto.reportFrequency !== undefined)
      data.reportFrequency = dto.reportFrequency;

    return data;
  }

  /**
   * Emite os tokens de aceite e recusa e manda o e-mail.
   *
   * `revokePrevious: false` é essencial: um aluno pode ter convites pendentes
   * de vários professores, e a revogação por tipo cancelaria o convite de um
   * professor no instante em que outro convidasse a mesma pessoa.
   */
  private async sendInvitation(
    relationshipId: string,
    teacherUser: { firstName: string | null; lastName: string | null },
    studentUser: {
      firstName: string | null;
      lastName: string | null;
      email: string | null;
    },
    studentUserId: string,
    context: RequestContext,
    options: { revokePrevious?: boolean } = {},
  ): Promise<void> {
    const metadata = { relationshipId };
    const revokePrevious = options.revokePrevious ?? false;

    const [acceptToken, declineToken] = await Promise.all([
      this.tokens.createToken({
        userId: studentUserId,
        type: TokenType.STUDENT_INVITATION_ACCEPT,
        metadata,
        revokePrevious,
        ...context,
      }),
      this.tokens.createToken({
        userId: studentUserId,
        type: TokenType.STUDENT_INVITATION_DECLINE,
        metadata,
        revokePrevious,
        ...context,
      }),
    ]);

    const baseUrl = this.configService.get<string>(
      'mediaSearch.frontendBaseUrl',
      'http://localhost:3000',
    );

    if (!studentUser.email) {
      // Conta sem e-mail não tem como receber o convite. O vínculo pendente
      // permanece e o professor pode reenviar depois que o aluno cadastrar um.
      this.logger.warn(
        `Convite ${relationshipId} não enviado: aluno sem e-mail cadastrado`,
      );
      return;
    }

    try {
      await this.mail.send({
        to: studentUser.email,
        subject: `${this.displayName(teacherUser)} convidou você para ser aluno`,
        html: this.invitationEmail({
          teacherName: this.displayName(teacherUser),
          studentName: this.displayName(studentUser),
          acceptUrl: `${baseUrl}/confirm-student-invite/${acceptToken}`,
          declineUrl: `${baseUrl}/decline-student-invite/${declineToken}`,
        }),
      });
    } catch (error: unknown) {
      // O vínculo pendente já existe e o convite pode ser reenviado; falhar o
      // envio não deve desfazer o convite nem devolver erro ao professor.
      this.logger.error(
        `Falha ao enviar convite para ${studentUser.email}: ${errorMessage(error)}`,
      );
    }
  }

  /** Valida o token, marca como usado e devolve o vínculo referenciado. */
  private async consumeInvitationToken(token: string, type: TokenType) {
    const validation = await this.tokens.validateToken(token, type);

    if (!validation.valid || !validation.token) {
      throw new BadRequestException(
        validation.expired
          ? 'Este convite expirou'
          : 'Convite inválido ou já utilizado',
      );
    }

    const metadata = validation.token.metadata as {
      relationshipId?: string;
    } | null;
    const relationshipId = metadata?.relationshipId;

    if (!relationshipId) {
      throw new BadRequestException('Convite malformado');
    }

    const relationship = await this.prisma.teacherStudent.findUnique({
      where: { id: relationshipId },
      include: {
        teacher: {
          select: {
            id: true,
            userId: true,
            user: { select: USER_SUMMARY_SELECT },
          },
        },
        student: {
          select: {
            id: true,
            userId: true,
            user: { select: USER_SUMMARY_SELECT },
          },
        },
      },
    });

    if (!relationship) {
      throw new NotFoundException('Convite não encontrado');
    }

    if (relationship.inviteStatus !== StudentInviteStatus.PENDING) {
      throw new BadRequestException('Este convite já foi respondido');
    }

    await this.tokens.markTokenAsUsed(token);

    return relationship;
  }

  /**
   * Limite de alunos do plano (RN-1).
   *
   * **Conta só vínculo aceito e ativo.** Convite pendente não ocupa vaga: quem
   * ainda não aceitou pode nunca aceitar, e bloquear por causa dele deixaria o
   * professor preso a um convite esquecido.
   *
   * **Quem já passou do teto não perde ninguém.** Ao trocar de plano para baixo,
   * os vínculos existentes continuam — aulas, tarefas e histórico seguem
   * funcionando. O que o limite impede é abrir mais um. Cortar aluno de forma
   * retroativa por mudança de plano tiraria acesso de quem não participou da
   * decisão.
   *
   * `-1` significa ilimitado, como no resto da matriz de planos.
   */
  private async assertWithinStudentLimit(
    teacherUserId: string,
    teacherId: string,
  ): Promise<void> {
    const access = await this.subscriptions.checkFeatureAccess(
      teacherUserId,
      'maxStudents',
    );

    const limit = access.limit;

    if (typeof limit !== 'number' || limit < 0) {
      return;
    }

    const active = await this.prisma.teacherStudent.count({
      where: {
        teacherId,
        isActive: true,
        inviteStatus: StudentInviteStatus.ACCEPTED,
      },
    });

    if (limit === 0) {
      throw new ForbiddenException(
        `Seu plano (${access.plan}) não inclui alunos. ` +
          'Assine o Mentor ou o Maestro para convidar.',
      );
    }

    if (active >= limit) {
      throw new ForbiddenException(
        `Seu plano (${access.plan}) permite ${limit} aluno(s) ativo(s). ` +
          'Encerre um vínculo ou mude de plano para convidar mais.',
      );
    }
  }

  private async requireTeacherProfile(userId: string) {
    const teacher = await this.prisma.teacher.findUnique({
      where: { userId },
      select: {
        id: true,
        userId: true,
        maxStudentsPerWeek: true,
        user: { select: USER_SUMMARY_SELECT },
      },
    });

    if (!teacher) {
      throw new ForbiddenException(
        'Você precisa de um perfil de professor para esta ação',
      );
    }

    return teacher;
  }

  /** Aulas futuras e pedidos pendentes de um par professor–aluno, cancelados. */
  private cancelFutureOf(
    teacherId: string,
    studentId: string,
    client: Pick<PrismaService, 'lesson' | 'lessonRequest'> = this.prisma,
  ) {
    const now = new Date();
    return [
      client.lesson.updateMany({
        where: {
          teacherId,
          studentId,
          status: LessonStatus.SCHEDULED,
          scheduledAt: { gte: now },
        },
        data: {
          status: LessonStatus.CANCELLED,
          cancelledAt: now,
          cancelReason: 'Vínculo encerrado',
        },
      }),
      client.lessonRequest.updateMany({
        where: { teacherId, studentId, status: LessonRequestStatus.PENDING },
        data: { status: LessonRequestStatus.CANCELLED },
      }),
    ] as const;
  }

  private async requireRelationship(relationshipId: string, teacherId: string) {
    const relationship = await this.prisma.teacherStudent.findUnique({
      where: { id: relationshipId },
      include: {
        student: {
          select: {
            id: true,
            userId: true,
            user: { select: USER_SUMMARY_SELECT },
          },
        },
      },
    });

    if (!relationship) {
      throw new NotFoundException('Vínculo não encontrado');
    }

    if (relationship.teacherId !== teacherId) {
      // 404 em vez de 403: confirmar a existência do vínculo de outro
      // professor já é informação demais.
      throw new NotFoundException('Vínculo não encontrado');
    }

    return relationship;
  }

  private displayName(user: {
    firstName: string | null;
    lastName: string | null;
  }): string {
    return (
      [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
      'Usuário'
    );
  }

  private invitationEmail(params: {
    teacherName: string;
    studentName: string;
    acceptUrl: string;
    declineUrl: string;
  }): string {
    return `
      <p>Olá, ${escapeHtml(params.studentName)}!</p>
      <p><strong>${escapeHtml(params.teacherName)}</strong> convidou você para ser aluno no Opus Atlas.</p>
      <p>
        <a href="${params.acceptUrl}">Aceitar convite</a> &nbsp;|&nbsp;
        <a href="${params.declineUrl}">Recusar</a>
      </p>
      <p>O convite vale por 30 dias.</p>
    `;
  }
}
