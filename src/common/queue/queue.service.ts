import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import { JobsOptions, Queue } from 'bullmq';
import { QueueName } from './queue.constants';
import { envelope, JobEnvelope } from './job-contract';

/** Sete dias de job concluído retido. É também a janela de deduplicação. */
const KEEP_COMPLETED_SECONDS = 7 * 24 * 60 * 60;

/** Trinta dias de falha retida — quem investiga chega depois do incidente. */
const KEEP_FAILED_SECONDS = 30 * 24 * 60 * 60;

const DEFAULT_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: KEEP_COMPLETED_SECONDS, count: 1_000 },
  removeOnFail: { age: KEEP_FAILED_SECONDS, count: 1_000 },
};

export interface EnqueueInput<TPayload> {
  queue: QueueName;
  /** Nome do job — é o que o processor usa para despachar. */
  job: string;
  /** Ver `buildIdempotencyKey`. Vira o `jobId`. */
  idempotencyKey: string;
  payload: TPayload;
  requestedBy?: string | null;
  options?: Pick<JobsOptions, 'attempts' | 'delay' | 'priority' | 'backoff'>;
}

export interface EnqueueResult {
  queue: QueueName;
  job: string;
  jobId: string;
  /**
   * Verdadeiro quando a chave já existia na fila e nada foi criado.
   *
   * É a resposta honesta a um duplo clique no botão de disparar: o chamador
   * recebe 202 com o **mesmo** id, não um segundo envio.
   */
  alreadyQueued: boolean;
}

/**
 * Ponto único de entrada na fila.
 *
 * Existe para que nenhum produtor decida sozinho quantas tentativas o job tem,
 * por quanto tempo o resultado fica guardado, ou se a chave de idempotência é
 * opcional — as três coisas que, decididas caso a caso, produzem uma fila em
 * que cada job se comporta de um jeito.
 *
 * As filas são resolvidas pelo `ModuleRef` em vez de injetadas uma a uma: uma
 * fila nova passa a existir editando `QUEUE_NAMES`, sem mexer aqui.
 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly resolved = new Map<QueueName, Queue>();

  constructor(private readonly moduleRef: ModuleRef) {}

  /**
   * Enfileira um trabalho.
   *
   * **A deduplicação vale enquanto o job estiver retido.** O `jobId` é a chave
   * de idempotência, e o BullMQ ignora um `add` cujo id já existe — mas assim
   * que o job concluído sai da retenção (sete dias), a mesma chave enfileira de
   * novo. Isso é aceitável e até desejável para trabalho recorrente; o que não
   * pode é o processor depender disso para não duplicar efeito.
   */
  async enqueue<TPayload>(
    input: EnqueueInput<TPayload>,
  ): Promise<EnqueueResult> {
    const queue = this.queue(input.queue);
    const jobId = input.idempotencyKey;

    const existing = await queue.getJob(jobId);

    if (existing) {
      this.logger.log(
        `Job já enfileirado, nada a fazer: ${input.queue}/${jobId}`,
      );

      return {
        queue: input.queue,
        job: input.job,
        jobId,
        alreadyQueued: true,
      };
    }

    const body: JobEnvelope<TPayload> = envelope({
      idempotencyKey: jobId,
      payload: input.payload,
      requestedBy: input.requestedBy,
    });

    await queue.add(input.job, body, {
      ...DEFAULT_OPTIONS,
      ...input.options,
      jobId,
    });

    this.logger.log(`Job enfileirado: ${input.queue}/${input.job} (${jobId})`);

    return {
      queue: input.queue,
      job: input.job,
      jobId,
      alreadyQueued: false,
    };
  }

  /**
   * Cria ou atualiza um agendamento recorrente.
   *
   * **Substitui `cron.schedule` dentro do processo.** O legado registrava o
   * cron na memória do Node a cada requisição de criação, e guardava a
   * definição num array de módulo. Três defeitos que isto resolve:
   *
   * 1. Reiniciar perdia todos os agendamentos, sem aviso e sem registro.
   * 2. Com N réplicas, cada uma registrava o seu — o backup diário rodava N
   *    vezes, uma por instância.
   * 3. Apagar o agendamento removia a linha do array e **nunca parava o cron**:
   *    a tarefa continuava rodando para sempre, sem nada que a descrevesse.
   *
   * O agendador do BullMQ vive no Redis: sobrevive a reinício, é único no
   * cluster, e remover de fato para.
   */
  async upsertSchedule<TPayload>(input: {
    queue: QueueName;
    /** Id estável do agendamento. Reusá-lo substitui a definição anterior. */
    schedulerId: string;
    /** Expressão cron de cinco campos. */
    cron: string;
    timezone: string;
    job: string;
    payload: TPayload;
    requestedBy?: string | null;
  }): Promise<void> {
    const body: JobEnvelope<TPayload> = envelope({
      // Cada disparo é um trabalho novo, então a chave do envelope identifica o
      // agendamento, não a execução — quem deduplica execução é o próprio
      // agendador, que só produz um job por ocorrência.
      idempotencyKey: input.schedulerId,
      payload: input.payload,
      requestedBy: input.requestedBy,
    });

    await this.queue(input.queue).upsertJobScheduler(
      input.schedulerId,
      { pattern: input.cron, tz: input.timezone },
      { name: input.job, data: body, opts: DEFAULT_OPTIONS },
    );

    this.logger.log(
      `Agendamento salvo: ${input.queue}/${input.schedulerId} (${input.cron} ${input.timezone})`,
    );
  }

  /** Agendamentos vivos de uma fila, direto do Redis. */
  async listSchedules(queueName: QueueName) {
    const schedulers = await this.queue(queueName).getJobSchedulers();

    return schedulers.map((scheduler) => ({
      schedulerId: scheduler.key,
      job: scheduler.name,
      cron: scheduler.pattern ?? null,
      timezone: scheduler.tz ?? null,
      nextRunAt: scheduler.next ? new Date(scheduler.next) : null,
    }));
  }

  /** Remove um agendamento. Diferente do legado, isto de fato o interrompe. */
  async removeSchedule(
    queueName: QueueName,
    schedulerId: string,
  ): Promise<boolean> {
    const removed = await this.queue(queueName).removeJobScheduler(schedulerId);

    if (removed) {
      this.logger.log(`Agendamento removido: ${queueName}/${schedulerId}`);
    }

    return removed;
  }

  /**
   * Remove um job ainda não iniciado.
   *
   * Só serve para o que está esperando ou agendado. Job em execução não é
   * cancelável por fora — o processor precisa terminar ou falhar.
   */
  async cancel(queueName: QueueName, jobId: string): Promise<boolean> {
    const job = await this.queue(queueName).getJob(jobId);

    if (!job) {
      return false;
    }

    const state = await job.getState();

    if (state === 'active') {
      return false;
    }

    await job.remove();
    return true;
  }

  /** `strict: false` porque as filas vivem no módulo do `@nestjs/bullmq`. */
  private queue(name: QueueName): Queue {
    const cached = this.resolved.get(name);

    if (cached) {
      return cached;
    }

    const queue = this.moduleRef.get<Queue>(getQueueToken(name), {
      strict: false,
    });

    this.resolved.set(name, queue);
    return queue;
  }
}
