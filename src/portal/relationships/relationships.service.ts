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
import {
  NotificationPriority,
  NotificationType,
  Prisma,
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

    const studentName = this.displayName(relationship.student.user);

    await this.notifications.notify({
      userId: relationship.teacher.userId,
      type: NotificationType.STUDENT_ACCEPTED_INVITE,
      priority: NotificationPriority.MEDIUM,
      title: 'Convite aceito',
      message: `${studentName} aceitou seu convite e agora é seu aluno.`,
      actionText: 'Ver aluno',
      actionUrl: `/teacher/students/${relationship.student.userId}`,
      relatedEntityType: 'teacherStudent',
      relatedEntityId: relationship.id,
    });

    await this.notifications.notify({
      userId: relationship.student.userId,
      type: NotificationType.WELCOME_NEW_STUDENT,
      priority: NotificationPriority.MEDIUM,
      title: 'Bem-vindo ao portal do aluno',
      message: `Você agora é aluno de ${this.displayName(relationship.teacher.user)}.`,
      actionText: 'Abrir portal',
      actionUrl: '/student',
      relatedEntityType: 'teacherStudent',
      relatedEntityId: relationship.id,
    });

    return {
      accepted: true,
      relationshipId: updated.id,
      teacherName: this.displayName(relationship.teacher.user),
    };
  }

  async declineInvitation(token: string) {
    const relationship = await this.consumeInvitationToken(
      token,
      TokenType.STUDENT_INVITATION_DECLINE,
    );

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
        include: {
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
        },
        orderBy: [{ inviteStatus: 'asc' }, { startDate: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.teacherStudent.count({ where }),
    ]);

    return {
      students: relationships.map((relationship) => ({
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
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
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
      return { teachers: [] };
    }

    const relationships = await this.prisma.teacherStudent.findMany({
      where: {
        studentId: student.id,
        inviteStatus: StudentInviteStatus.ACCEPTED,
        isActive: true,
      },
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

    return {
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
      }
    });

    await this.cache.invalidateMany([CacheNamespace.TEACHERS]);
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
