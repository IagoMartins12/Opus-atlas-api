import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { ArticlePublishingService } from '../blog/articles/article-publishing.service';
import {
  JOB_BLOG_PUBLISH_SCHEDULED,
  JOB_MODERATION_SLA_SWEEP,
  JOB_NOTIFICATIONS_SWEEP,
  QUEUE_NOTIFICATIONS,
} from '../common/queue/queue.constants';
import { QueueService } from '../common/queue/queue.service';
import { NotificationSweepService } from '../portal/notifications/notification-sweep.service';
import { ModerationSweepService } from '../uploads/moderation/moderation-sweep.service';

/**
 * De quanto em quanto tempo a base é varrida.
 *
 * Cinco minutos é a resolução do aviso mais apertado: "sua aula começa em 30
 * minutos" tolera cinco minutos de atraso, e a chave de deduplicação impede que
 * a repetição da varredura vire repetição do aviso.
 */
const SWEEP_CRON = '*/5 * * * *';

const SCHEDULER_ID = 'notifications:sweep';

/**
 * De quanto em quanto tempo a fila de moderação é conferida.
 *
 * De hora em hora. O prazo mais apertado da RN-4 é de 24 horas, então conferir
 * a cada cinco minutos só produziria a mesma resposta doze vezes; e conferir
 * uma vez por dia deixaria uma denúncia urgente estourar o prazo por quase um
 * dia inteiro antes de alguém saber.
 */
const MODERATION_CRON = '0 * * * *';

const MODERATION_SCHEDULER_ID = 'moderation:sla-sweep';

/**
 * De quanto em quanto tempo os artigos agendados são conferidos.
 *
 * De minuto em minuto: é a resolução com que alguém agenda ("às 9h"). A
 * consulta só olha os artigos em `SCHEDULED` — hoje, nenhum — e não custa nada
 * quando não há o que publicar.
 */
const BLOG_PUBLISH_CRON = '* * * * *';

const BLOG_PUBLISH_SCHEDULER_ID = 'blog:publish-scheduled';

/**
 * Consumidor das notificações automáticas.
 *
 * **O agendamento é declarado em código e reafirmado a cada subida do worker.**
 * Não há rota para ligá-lo ou desligá-lo, e isso é deliberado: avisar o aluno
 * que a tarefa vence hoje não é decisão de operação, é comportamento do
 * produto. Um agendamento que alguém precisa lembrar de criar é um
 * agendamento que um dia não vai existir — que é exatamente o que acontecia
 * quando a geração dependia de o navegador do usuário perguntar.
 *
 * `upsertJobScheduler` é idempotente: subir dez réplicas do worker reafirma o
 * mesmo agendamento, não cria dez.
 */
@Processor(QUEUE_NOTIFICATIONS, { concurrency: 1 })
export class NotificationsProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly sweep: NotificationSweepService,
    private readonly moderationSweep: ModerationSweepService,
    private readonly articlePublishing: ArticlePublishingService,
    private readonly queue: QueueService,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertSchedule({
      queue: QUEUE_NOTIFICATIONS,
      schedulerId: SCHEDULER_ID,
      cron: SWEEP_CRON,
      timezone: 'America/Sao_Paulo',
      job: JOB_NOTIFICATIONS_SWEEP,
      payload: {},
      requestedBy: null,
    });

    this.logger.log(`Varredura de notificações agendada: ${SWEEP_CRON}`);

    await this.queue.upsertSchedule({
      queue: QUEUE_NOTIFICATIONS,
      schedulerId: MODERATION_SCHEDULER_ID,
      cron: MODERATION_CRON,
      timezone: 'America/Sao_Paulo',
      job: JOB_MODERATION_SLA_SWEEP,
      payload: {},
      requestedBy: null,
    });

    this.logger.log(`Prazo de moderação conferido: ${MODERATION_CRON}`);

    await this.queue.upsertSchedule({
      queue: QUEUE_NOTIFICATIONS,
      schedulerId: BLOG_PUBLISH_SCHEDULER_ID,
      cron: BLOG_PUBLISH_CRON,
      timezone: 'America/Sao_Paulo',
      job: JOB_BLOG_PUBLISH_SCHEDULED,
      payload: {},
      requestedBy: null,
    });

    this.logger.log(`Artigos agendados conferidos: ${BLOG_PUBLISH_CRON}`);
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case JOB_NOTIFICATIONS_SWEEP:
        return this.sweep.sweep();
      case JOB_MODERATION_SLA_SWEEP:
        return this.moderationSweep.sweep();
      case JOB_BLOG_PUBLISH_SCHEDULED:
        return this.articlePublishing.publishDue();
      default:
        throw new UnrecoverableError(
          `Job desconhecido na fila ${QUEUE_NOTIFICATIONS}: ${job.name}`,
        );
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error): void {
    this.logger.error(
      `Varredura de notificações (${job.id}) falhou na tentativa ${job.attemptsMade}: ${error.message}`,
    );
  }
}
