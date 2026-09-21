import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  NotificationPriority,
  NotificationStatus,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { errorMessage } from '../../common/utils/error.util';
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
}

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

  constructor(private readonly prisma: PrismaService) {}

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
        },
      });
    } catch (error: unknown) {
      this.logger.error(
        `Falha ao notificar ${input.userId} (${input.type}): ${errorMessage(error)}`,
      );
    }
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
    return {
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
