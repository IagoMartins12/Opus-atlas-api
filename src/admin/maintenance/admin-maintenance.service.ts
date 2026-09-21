import { BadRequestException, Injectable } from '@nestjs/common';
import { QueueService } from '../../common/queue/queue.service';
import { JobStatusService } from '../../common/queue/job-status.service';
import {
  JOB_MAINTENANCE_RUN,
  QUEUE_MAINTENANCE,
} from '../../common/queue/queue.constants';
import { buildIdempotencyKey } from '../../common/queue/job-contract';
import {
  findTask,
  MAINTENANCE_CATALOG,
  MaintenanceTaskId,
  SCHEDULE_TIMEZONE,
} from './maintenance-catalog';

/**
 * Cron de cinco campos, que é o que o agendador do BullMQ aceita.
 *
 * A validação é frouxa de propósito — reimplementar o parser de cron aqui seria
 * duplicar o que a biblioteca já faz, e ela recusa o que não entende. O que
 * este teste barra é o erro grosseiro (campo a menos, texto no lugar de
 * expressão) antes de chegar ao Redis.
 */
const CRON_FIELDS = 5;

export interface RunTaskInput {
  taskId: MaintenanceTaskId;
  /** Sem `confirm`, tarefa destrutiva roda em simulação. */
  confirm: boolean;
  retentionDays?: number;
  requestedBy: string | null;
}

/** Carga do job de manutenção. */
export interface MaintenanceJobPayload {
  taskId: MaintenanceTaskId;
  dryRun: boolean;
  retentionDays?: number;
}

@Injectable()
export class AdminMaintenanceService {
  constructor(
    private readonly queue: QueueService,
    private readonly status: JobStatusService,
  ) {}

  /**
   * O catálogo, com o agendamento vivo de cada tarefa.
   *
   * O estado de execução **não** vem daqui: vem da fila, por
   * `GET /admin/jobs/maintenance/:jobId`. O legado guardava `status` e
   * `progress` dentro do próprio objeto de tarefa, na memória do processo — e
   * era por isso que duas réplicas discordavam sobre a mesma tarefa estar
   * rodando.
   */
  async listTasks() {
    const schedules = await this.queue.listSchedules(QUEUE_MAINTENANCE);
    const byId = new Map(
      schedules.map((schedule) => [schedule.schedulerId, schedule]),
    );

    return {
      tasks: MAINTENANCE_CATALOG.map((task) => {
        const schedule = byId.get(this.schedulerId(task.id));

        return {
          ...task,
          schedule: schedule
            ? {
                cron: schedule.cron,
                timezone: schedule.timezone,
                nextRunAt: schedule.nextRunAt,
              }
            : null,
        };
      }),
      timezone: SCHEDULE_TIMEZONE,
    };
  }

  /**
   * Enfileira uma execução.
   *
   * **Tarefa destrutiva sem `confirm` vira simulação.** Não é cerimônia: as
   * três tarefas de expurgo apagam dado que não volta, e a diferença entre
   * "quero ver quanto seria" e "pode apagar" precisa estar no pedido, não na
   * memória de quem clicou.
   */
  async runTask(input: RunTaskInput) {
    const task = findTask(input.taskId);
    const dryRun = task.destructive && !input.confirm;

    // A chave inclui o minuto: um clique repetido no mesmo minuto é o mesmo
    // trabalho, e rodar a mesma limpeza duas vezes seguidas não ajuda ninguém.
    // Passado o minuto, uma execução nova é uma execução nova.
    const minute = new Date().toISOString().slice(0, 16);

    const enqueued = await this.queue.enqueue<MaintenanceJobPayload>({
      queue: QUEUE_MAINTENANCE,
      job: JOB_MAINTENANCE_RUN,
      idempotencyKey: buildIdempotencyKey(
        'maintenance',
        input.taskId,
        dryRun ? 'simulacao' : 'aplicando',
        minute,
      ),
      payload: {
        taskId: input.taskId,
        dryRun,
        retentionDays: input.retentionDays,
      },
      requestedBy: input.requestedBy,
    });

    return {
      ...enqueued,
      task: { id: task.id, name: task.name, destructive: task.destructive },
      dryRun,
      ...(dryRun && task.destructive
        ? {
            aviso:
              'Tarefa destrutiva enfileirada em simulação. Repita com `confirm: true` para aplicar.',
          }
        : {}),
    };
  }

  async listSchedules() {
    const schedules = await this.queue.listSchedules(QUEUE_MAINTENANCE);

    return {
      schedules: schedules.map((schedule) => ({
        ...schedule,
        taskId: this.taskIdFromScheduler(schedule.schedulerId),
      })),
      timezone: SCHEDULE_TIMEZONE,
    };
  }

  /**
   * Cria ou substitui o agendamento de uma tarefa.
   *
   * **Uma tarefa, um agendamento.** O legado deixava empilhar quantos quisesse
   * (`BACKUP_SCHEDULES.push`), cada um registrando um cron próprio, sem nada
   * que impedisse dois agendamentos idênticos rodando lado a lado. Aqui o id do
   * agendador é derivado da tarefa: salvar de novo substitui.
   */
  async setSchedule(input: {
    taskId: MaintenanceTaskId;
    cron: string;
    confirm: boolean;
    retentionDays?: number;
    requestedBy: string | null;
  }) {
    const task = findTask(input.taskId);
    this.assertCron(input.cron);

    if (task.destructive && !input.confirm) {
      throw new BadRequestException(
        `"${task.name}" apaga dado de forma irreversível. Agende com \`confirm: true\` para que as execuções apliquem, ou ela rodaria em simulação para sempre.`,
      );
    }

    await this.queue.upsertSchedule<MaintenanceJobPayload>({
      queue: QUEUE_MAINTENANCE,
      schedulerId: this.schedulerId(task.id),
      cron: input.cron,
      timezone: SCHEDULE_TIMEZONE,
      job: JOB_MAINTENANCE_RUN,
      payload: {
        taskId: task.id,
        // Execução agendada aplica: o `confirm` foi dado aqui, uma vez, por
        // quem criou o agendamento.
        dryRun: false,
        retentionDays: input.retentionDays,
      },
      requestedBy: input.requestedBy,
    });

    const saved = (await this.queue.listSchedules(QUEUE_MAINTENANCE)).find(
      (schedule) => schedule.schedulerId === this.schedulerId(task.id),
    );

    return {
      taskId: task.id,
      cron: input.cron,
      timezone: SCHEDULE_TIMEZONE,
      nextRunAt: saved?.nextRunAt ?? null,
    };
  }

  async removeSchedule(taskId: MaintenanceTaskId): Promise<boolean> {
    return this.queue.removeSchedule(
      QUEUE_MAINTENANCE,
      this.schedulerId(taskId),
    );
  }

  /** Últimas falhas da fila de manutenção, sem sair da área. */
  async recentFailures(limit: number) {
    return {
      failures: await this.status.failures(QUEUE_MAINTENANCE, limit),
    };
  }

  private schedulerId(taskId: MaintenanceTaskId): string {
    return `maintenance:${taskId}`;
  }

  private taskIdFromScheduler(schedulerId: string): string {
    return schedulerId.replace(/^maintenance:/, '');
  }

  private assertCron(cron: string): void {
    const fields = cron.trim().split(/\s+/);

    if (fields.length !== CRON_FIELDS) {
      throw new BadRequestException(
        `Expressão cron precisa de ${CRON_FIELDS} campos (minuto hora dia mês dia-da-semana). Recebido: "${cron}".`,
      );
    }
  }
}
