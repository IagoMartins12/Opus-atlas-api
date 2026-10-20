import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  SchoolActivityAction,
  NotificationPriority,
  NotificationStatus,
  NotificationType,
  Prisma,
  StudentInviteStatus,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { errorMessage } from '../../common/utils/error.util';
import { MailService } from '../../mail/mail.service';
import {
  quietUntil,
  resolvePreferences,
  topicOf,
  TOPICS,
} from './notification-channels';
import { AnnouncementDto, UpdatePreferencesDto } from './dto/preferences.dto';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { MarkShownDto } from './dto/mark-shown.dto';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  priority?: NotificationPriority;
  actionText?: string;
  actionUrl?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  metadata?: Prisma.InputJsonValue;
  /** Sem valor, a notificação é permanente até ser lida. */
  expiresAt?: Date;
  /**
   * Chave de deduplicação. Duas notificações com o mesmo hash para o mesmo
   * usuário não coexistem — evita avisar cinco vezes sobre a mesma aula.
   */
  uniqueHash?: string;
  /** Envio agendado: o aviso só aparece (e o e-mail só sai) a partir daqui. */
  scheduledFor?: Date;
  /**
   * Canais escolhidos por quem enviou (aviso avulso do professor). Sem valor,
   * vale só a preferência de quem recebe.
   */
  channels?: { email?: boolean; sms?: boolean };
}

/** O fuso de quem recebe, até o usuário ter fuso próprio. */
const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';
/** Quantos e-mails uma passada da varredura envia, no máximo. */
const EMAIL_BATCH = 100;
/** Depois de tantas falhas o e-mail desiste (o aviso continua no portal). */
const MAX_EMAIL_ATTEMPTS = 5;

/**
 * Notificações do portal.
 *
 * **Um serviço só para aluno e professor.** No legado havia dois conjuntos de
 * rotas praticamente idênticos (`student/notifications/*` e
 * `teacher/notifications/*`), diferindo apenas no papel exigido pelo guard.
 * A notificação pertence ao usuário, não ao papel dele: quem é professor e
 * aluno ao mesmo tempo tinha duas caixas de entrada separadas para o mesmo
 * `userId`.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  // -------------------------------------------------------------------
  // Leitura
  // -------------------------------------------------------------------

  async list(userId: string, query: ListNotificationsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.includeExpired ? {} : this.notExpired()),
    };

    const [notifications, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: NOTIFICATION_SELECT,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: {
          userId,
          status: NotificationStatus.UNREAD,
          ...this.notExpired(),
        },
      }),
    ]);

    return {
      notifications,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      unreadCount,
    };
  }

  /**
   * Notificações que ainda não foram exibidas num canal.
   *
   * Serve ao aviso em tela: o front pergunta o que falta mostrar, exibe, e
   * confirma com `mark-shown` — assim o mesmo aviso não reaparece a cada
   * navegação.
   */
  async pendingToShow(userId: string, channel: 'toast' | 'browser') {
    return this.prisma.notification.findMany({
      where: {
        userId,
        status: NotificationStatus.UNREAD,
        ...(channel === 'toast'
          ? { showInToast: true, toastShown: false }
          : { showInBrowser: true, browserShown: false }),
        ...this.notExpired(),
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: 10,
      select: NOTIFICATION_SELECT,
    });
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: {
        userId,
        status: NotificationStatus.UNREAD,
        ...this.notExpired(),
      },
    });
  }

  // -------------------------------------------------------------------
  // Escrita
  // -------------------------------------------------------------------

  async markAsRead(userId: string, notificationId: string) {
    const updated = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { status: NotificationStatus.READ, readAt: new Date() },
    });

    if (updated.count === 0) {
      throw new NotFoundException('Notificação não encontrada');
    }
  }

  async markAllAsRead(userId: string): Promise<number> {
    const updated = await this.prisma.notification.updateMany({
      where: { userId, status: NotificationStatus.UNREAD },
      data: { status: NotificationStatus.READ, readAt: new Date() },
    });

    return updated.count;
  }

  async markAsShown(
    userId: string,
    notificationId: string,
    dto: MarkShownDto,
  ): Promise<void> {
    const data: Prisma.NotificationUpdateManyMutationInput =
      dto.channel === 'toast'
        ? { toastShown: true, lastShownAt: new Date() }
        : { browserShown: true, lastShownAt: new Date() };

    const updated = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data,
    });

    if (updated.count === 0) {
      throw new NotFoundException('Notificação não encontrada');
    }
  }

  async dismiss(userId: string, notificationId: string): Promise<void> {
    const updated = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { status: NotificationStatus.DISMISSED },
    });

    if (updated.count === 0) {
      throw new NotFoundException('Notificação não encontrada');
    }
  }

  // -------------------------------------------------------------------
  // Emissão — usada pelos demais módulos do portal
  // -------------------------------------------------------------------

  /**
   * Cria uma notificação.
   *
   * Nunca lança: notificar é efeito colateral de uma ação de negócio que já
   * aconteceu. Falhar aqui não pode desfazer o agendamento de uma aula nem
   * devolver erro para quem a agendou.
   */
  async notify(input: CreateNotificationInput): Promise<void> {
    try {
      if (input.uniqueHash) {
        const existing = await this.prisma.notification.findFirst({
          where: {
            userId: input.userId,
            uniqueHash: input.uniqueHash,
            status: NotificationStatus.UNREAD,
          },
          select: { id: true },
        });

        if (existing) {
          return;
        }
      }

      const delivery = await this.deliveryOf(input);

      await this.prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          message: input.message,
          priority: input.priority ?? NotificationPriority.MEDIUM,
          actionText: input.actionText,
          actionUrl: input.actionUrl,
          relatedEntityType: input.relatedEntityType,
          relatedEntityId: input.relatedEntityId,
          metadata: input.metadata,
          expiresAt: input.expiresAt,
          uniqueHash: input.uniqueHash,
          scheduledFor: input.scheduledFor,
          ...delivery,
        },
      });
    } catch (error: unknown) {
      this.logger.error(
        `Falha ao notificar ${input.userId} (${input.type}): ${errorMessage(error)}`,
      );
    }
  }

  /**
   * Como o aviso sai fora do portal — a caixa de saída.
   *
   * Criar o aviso **não envia e-mail**: só marca "pending" com o instante a
   * partir do qual pode sair (agora, o fim do horário de silêncio de quem
   * recebe, ou o envio agendado). A varredura do worker, de minuto em minuto,
   * envia (`flushEmails`). Assim nenhuma requisição espera o SMTP, e uma
   * falha passageira tenta de novo em vez de sumir.
   */
  private async deliveryOf(input: CreateNotificationInput) {
    const topic = topicOf(input.type);
    if (!topic) return {};

    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        email: true,
        notificationChannels: true,
        quietHoursStart: true,
        quietHoursEnd: true,
      },
    });
    if (!user) return {};

    const prefs = resolvePreferences(user.notificationChannels)[topic.key];
    const wantsEmail =
      prefs.email && (input.channels?.email ?? true) && !!user.email;
    const wantsSms = prefs.sms && (input.channels?.sms ?? true);

    const notBefore =
      input.scheduledFor && input.scheduledFor > new Date()
        ? input.scheduledFor
        : new Date();
    const afterQuiet = quietUntil(
      notBefore,
      { start: user.quietHoursStart, end: user.quietHoursEnd },
      DEFAULT_TIME_ZONE,
    );

    return {
      emailStatus: wantsEmail ? 'pending' : 'skipped',
      emailAfter: wantsEmail ? (afterQuiet ?? notBefore) : null,
      // Guardado como escolha; o envio por SMS ainda não existe.
      smsStatus: wantsSms ? 'unsupported' : null,
    };
  }

  /**
   * Envia os e-mails pendentes cujo horário chegou. Chamado pela varredura.
   * Devolve quantos saíram.
   */
  async flushEmails(
    now = new Date(),
  ): Promise<{ sent: number; failed: number }> {
    const due = await this.prisma.notification.findMany({
      where: { emailStatus: 'pending', emailAfter: { lte: now } },
      select: {
        id: true,
        title: true,
        message: true,
        actionText: true,
        actionUrl: true,
        metadata: true,
        user: { select: { email: true, firstName: true } },
      },
      orderBy: { emailAfter: 'asc' },
      take: EMAIL_BATCH,
    });

    const base = this.config.get<string>('mediaSearch.frontendBaseUrl') ?? '';
    let sent = 0;
    let failed = 0;

    for (const n of due) {
      if (!n.user?.email) {
        await this.prisma.notification.update({
          where: { id: n.id },
          data: { emailStatus: 'skipped' },
        });
        continue;
      }
      const result = await this.mail.sendPortalNotice(n.user.email, {
        firstName: n.user.firstName ?? '',
        title: n.title,
        message: n.message,
        actionText: n.actionText,
        actionUrl: n.actionUrl
          ? n.actionUrl.startsWith('http')
            ? n.actionUrl
            : `${base}${n.actionUrl}`
          : null,
      });

      if (result.delivered) {
        sent++;
        await this.prisma.notification.update({
          where: { id: n.id },
          data: { emailStatus: 'sent' },
        });
      } else {
        failed++;
        const meta = (
          n.metadata && typeof n.metadata === 'object' ? n.metadata : {}
        ) as Record<string, unknown>;
        const attempts = Number(meta.emailAttempts ?? 0) + 1;
        await this.prisma.notification.update({
          where: { id: n.id },
          data:
            attempts >= MAX_EMAIL_ATTEMPTS
              ? {
                  emailStatus: 'failed',
                  metadata: { ...meta, emailAttempts: attempts },
                }
              : {
                  // Espera crescente: 2, 4, 8, 16 minutos.
                  emailAfter: new Date(now.getTime() + 2 ** attempts * 60_000),
                  metadata: { ...meta, emailAttempts: attempts },
                },
        });
      }
    }

    if (sent || failed)
      this.logger.log(
        `E-mails do portal: ${sent} enviados, ${failed} com falha`,
      );
    return { sent, failed };
  }

  // -------------------------------------------------------------------
  // Preferências (04/10/2026)
  // -------------------------------------------------------------------

  /** Os temas que fazem sentido para os papéis de quem pergunta, com as escolhas. */
  async getPreferences(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        phone: true,
        isTeacher: true,
        isStudent: true,
        notificationChannels: true,
        quietHoursStart: true,
        quietHoursEnd: true,
      },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const resolved = resolvePreferences(user.notificationChannels);
    const fits = (audience: string) =>
      audience === 'both' ||
      (audience === 'teacher' && user.isTeacher) ||
      (audience === 'student' && user.isStudent);

    return {
      topics: TOPICS.filter((t) => fits(t.audience)).map((t) => ({
        key: t.key,
        label: t.label,
        audience: t.audience,
        ...resolved[t.key],
      })),
      quietHoursStart: user.quietHoursStart,
      quietHoursEnd: user.quietHoursEnd,
      hasEmail: !!user.email,
      hasPhone: !!user.phone,
      smsAvailable: false,
    };
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { notificationChannels: true },
    });
    if (!current) throw new NotFoundException('Usuário não encontrado');

    const known = new Set(TOPICS.map((t) => t.key));
    const merged = {
      ...((current.notificationChannels as Record<string, unknown> | null) ??
        {}),
    } as Record<string, { email?: boolean; sms?: boolean }>;
    for (const [key, choice] of Object.entries(dto.channels ?? {})) {
      if (!known.has(key)) continue;
      merged[key] = {
        ...merged[key],
        ...(typeof choice?.email === 'boolean' ? { email: choice.email } : {}),
        ...(typeof choice?.sms === 'boolean' ? { sms: choice.sms } : {}),
      };
    }

    // Silêncio só faz sentido com os dois horários.
    const quiet =
      dto.quietHoursStart === undefined && dto.quietHoursEnd === undefined
        ? {}
        : dto.quietHoursStart && dto.quietHoursEnd
          ? {
              quietHoursStart: dto.quietHoursStart,
              quietHoursEnd: dto.quietHoursEnd,
            }
          : { quietHoursStart: null, quietHoursEnd: null };

    await this.prisma.user.update({
      where: { id: userId },
      data: { notificationChannels: merged as Prisma.InputJsonValue, ...quiet },
    });
    return this.getPreferences(userId);
  }

  /**
   * Aviso avulso do professor para alunos dele (04/10/2026).
   *
   * Só para quem estuda com ele (vínculo ativo e aceito). O professor escolhe
   * os canais; cada aluno recebe pelos que ele aceita — a resposta diz como
   * chegou para cada um, que é o que a tela mostra antes de enviar.
   */
  async announce(teacherUserId: string, dto: AnnouncementDto) {
    const teacher = await this.prisma.teacher.findUnique({
      where: { userId: teacherUserId },
      select: {
        id: true,
        user: { select: { firstName: true, lastName: true } },
      },
    });
    if (!teacher)
      throw new ForbiddenException('Você não tem perfil de professor');

    const links = await this.prisma.teacherStudent.findMany({
      where: {
        teacherId: teacher.id,
        studentId: { in: dto.studentIds },
        isActive: true,
        inviteStatus: StudentInviteStatus.ACCEPTED,
      },
      select: { student: { select: { id: true, userId: true } } },
    });
    if (links.length === 0)
      throw new ForbiddenException('Nenhum desses alunos estuda com você');

    const sendAt = dto.sendAt ? new Date(dto.sendAt) : undefined;
    const from =
      [teacher.user.firstName, teacher.user.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() || 'Seu professor';

    await this.notifyMany(
      links.map(({ student }) => ({
        userId: student.userId,
        type: NotificationType.TEACHER_ANNOUNCEMENT,
        priority: NotificationPriority.MEDIUM,
        title: dto.title.trim(),
        message: `${from}: ${dto.message.trim()}`,
        actionText: 'Abrir avisos',
        actionUrl: '/student/notifications',
        relatedEntityType: 'teacher',
        relatedEntityId: teacher.id,
        scheduledFor: sendAt && sendAt > new Date() ? sendAt : undefined,
        channels: {
          email: dto.channels?.email ?? false,
          sms: dto.channels?.sms ?? false,
        },
      })),
    );

    // No histórico do professor. Direto pelo Prisma: este serviço é usado por
    // todo o portal e pelo worker, e não ganha uma dependência só por isto.
    await this.prisma.schoolActivity
      .create({
        data: {
          userId: teacherUserId,
          userType: 'teacher',
          action: SchoolActivityAction.ANNOUNCEMENT_SENT,
          entityType: 'student',
          title: `Enviou um aviso: ${dto.title.trim()}`,
          description: `Para ${links.length} ${links.length === 1 ? 'aluno' : 'alunos'}`,
        },
      })
      .catch((error: unknown) =>
        this.logger.error(
          `Falha ao registrar o aviso no histórico: ${errorMessage(error)}`,
        ),
      );

    return {
      delivered: links.length,
      skipped: dto.studentIds.length - links.length,
      scheduledFor: sendAt ?? null,
    };
  }

  /** Emite a mesma notificação para vários usuários. */
  async notifyMany(inputs: CreateNotificationInput[]): Promise<void> {
    await Promise.all(inputs.map((input) => this.notify(input)));
  }

  // -------------------------------------------------------------------

  /**
   * Notificação vigente: sem prazo, ou com prazo ainda no futuro.
   *
   * O legado filtrava só por `expiresAt: { gte: now }`, o que **descartava
   * silenciosamente toda notificação sem prazo** — e nenhuma das notificações
   * de evento real (feedback do professor, comentário em relatório) define
   * prazo. Elas eram criadas e nunca apareciam para o usuário.
   */
  private notExpired(): Prisma.NotificationWhereInput {
    const now = new Date();
    return {
      // Aviso agendado só aparece a partir do horário marcado.
      AND: [
        {
          OR: [
            { scheduledFor: null },
            { scheduledFor: { isSet: false } },
            { scheduledFor: { lte: now } },
          ],
        },
      ],
      OR: [
        // Três casos, não dois. No MongoDB, campo nunca escrito fica
        // **ausente**, e o Prisma distingue ausente de nulo — `expiresAt: null`
        // não alcança o documento em que a chave não existe. Como `notify()`
        // omite `expiresAt` quando não há prazo, toda notificação sem prazo cai
        // justamente nesse caso.
        { expiresAt: null },
        { expiresAt: { isSet: false } },
        { expiresAt: { gte: new Date() } },
      ],
    };
  }
}

const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  priority: true,
  status: true,
  title: true,
  message: true,
  actionText: true,
  actionUrl: true,
  relatedEntityType: true,
  relatedEntityId: true,
  toastShown: true,
  browserShown: true,
  expiresAt: true,
  createdAt: true,
  readAt: true,
} as const;
