import { Injectable, Logger } from '@nestjs/common';
import { NotificationPriority, NotificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../portal/notifications/notifications.service';
import { SLA_HOURS, slaMillis } from './moderation-sla';
import { ReportPriority } from './report-categories';

/** Quantos administradores são avisados por rodada. */
const MAX_ADMINS = 50;

/** `User.role` numérico: 0 comum, 1 admin, 2 super admin. */
const ROLE_ADMIN = 1;

export interface OverdueSweepResult {
  /** Denúncias pendentes que passaram do prazo. */
  overdue: number;
  /** Por prioridade, para o aviso dizer o que é urgente. */
  byPriority: Record<string, number>;
  /** Administradores avisados. */
  notified: number;
}

/**
 * Varredura de denúncias fora do prazo.
 *
 * **É isto que faz o SLA existir.** Sem alguém olhando o relógio, os prazos da
 * RN-4 seriam números num documento: a denúncia urgente ficaria na fila os
 * mesmos trinta dias que a denúncia de item duplicado, e ninguém saberia. A
 * varredura não decide nada e não move conteúdo — ela só avisa quem pode
 * decidir, que é o ponto em que a regra encosta na realidade.
 *
 * Roda pela fila, como a varredura de notificações do portal.
 */
@Injectable()
export class ModerationSweepService {
  private readonly logger = new Logger(ModerationSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async sweep(now: Date = new Date()): Promise<OverdueSweepResult> {
    const byPriority: Record<string, number> = {};
    let overdue = 0;

    // Uma consulta por prioridade, cada uma com o seu corte de tempo. É mais
    // barato do que trazer a fila inteira para comparar em memória, e cresce
    // com o número de prioridades — que é quatro — e não com o da fila.
    for (const priority of Object.keys(SLA_HOURS) as ReportPriority[]) {
      // Denúncia criada antes deste instante já estourou o prazo.
      const cutoff = new Date(now.getTime() - slaMillis(priority));

      const count = await this.prisma.uploadModeration.count({
        where: {
          status: 'pending',
          priority,
          createdAt: { lt: cutoff },
        },
      });

      if (count > 0) {
        byPriority[priority] = count;
        overdue += count;
      }
    }

    if (overdue === 0) {
      return { overdue, byPriority, notified: 0 };
    }

    const admins = await this.prisma.user.findMany({
      where: { role: { gte: ROLE_ADMIN } },
      select: { id: true },
      take: MAX_ADMINS,
    });

    const detalhe = Object.entries(byPriority)
      .map(([priority, count]) => `${count} ${priority}`)
      .join(', ');

    await this.notifications.notifyMany(
      admins.map((admin) => ({
        userId: admin.id,
        type: NotificationType.GENERAL_ANNOUNCEMENT,
        priority: byPriority.urgent
          ? NotificationPriority.HIGH
          : NotificationPriority.MEDIUM,
        title: `${overdue} denúncia${overdue === 1 ? '' : 's'} fora do prazo`,
        message: `Aguardando análise além do prazo: ${detalhe}.`,
        actionText: 'Abrir fila de moderação',
        actionUrl: '/admin/uploads/moderation',
        // Um aviso por dia por administrador: a varredura roda de hora em
        // hora, e cinco avisos idênticos são o mesmo que nenhum.
        uniqueHash: `moderation-overdue:${admin.id}:${now.toISOString().slice(0, 10)}`,
      })),
    );

    this.logger.warn(
      `Moderação fora do prazo: ${detalhe} — ${admins.length} administradores avisados`,
    );

    return { overdue, byPriority, notified: admins.length };
  }
}
