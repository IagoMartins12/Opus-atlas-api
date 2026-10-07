import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { MaintenanceJobPayload } from '../admin/maintenance/admin-maintenance.service';
import {
  findTask,
  MaintenanceTaskId,
  SCHEDULE_TIMEZONE,
} from '../admin/maintenance/maintenance-catalog';
import {
  JOB_MAINTENANCE_RUN,
  QUEUE_MAINTENANCE,
  QUEUE_NAMES,
} from '../common/queue/queue.constants';
import { QueueService } from '../common/queue/queue.service';
import { errorMessage } from '../common/utils/error.util';

/**
 * As limpezas que passam a rodar sozinhas (decisão de 01/10). Antes nenhuma
 * tinha agendamento: "Expurgar tokens vencidos" só rodava se alguém clicasse.
 */
export const LIMPEZAS_PADRAO: readonly MaintenanceTaskId[] = [
  'tokens.prune',
  'notifications.prune',
  'audit.prune',
];

/**
 * Ao subir o worker: reaplica no Redis os agendamentos guardados no Mongo e
 * cria as limpezas padrão que nunca existiram.
 *
 * Os agendamentos de manutenção e de scraper viviam só no Redis — que, aqui,
 * salva em disco no máximo a cada hora. Um Redis recriado os perdia sem que
 * ninguém notasse. Removido por alguém, o padrão não volta: o registro fica
 * desligado no Mongo.
 */
@Injectable()
export class SchedulesKeeper implements OnApplicationBootstrap {
  private readonly logger = new Logger(SchedulesKeeper.name);

  constructor(private readonly queue: QueueService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const reaplicados = await this.queue.reaplicarAgendamentos(QUEUE_NAMES);
      this.logger.log(`Agendamentos reaplicados do banco: ${reaplicados}`);

      for (const taskId of LIMPEZAS_PADRAO) {
        const task = findTask(taskId);
        if (!task.suggestedCron) continue;

        const criado =
          await this.queue.agendarSeNuncaExistiu<MaintenanceJobPayload>({
            queue: QUEUE_MAINTENANCE,
            schedulerId: `maintenance:${taskId}`,
            cron: task.suggestedCron,
            timezone: SCHEDULE_TIMEZONE,
            job: JOB_MAINTENANCE_RUN,
            payload: {
              taskId,
              dryRun: false,
              retentionDays: task.retentionDays,
            },
            requestedBy: null,
          });

        if (criado) {
          this.logger.log(
            `Limpeza agendada: ${task.name} (${task.suggestedCron})`,
          );
        }
      }
    } catch (error: unknown) {
      // Não derruba o worker: as filas seguem funcionando com o que o Redis tem.
      this.logger.error(
        `Agendamentos não foram reaplicados: ${errorMessage(error)}`,
      );
    }
  }
}
