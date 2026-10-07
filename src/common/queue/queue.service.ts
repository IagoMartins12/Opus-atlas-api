import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import { Prisma } from '@prisma/client';
import { JobsOptions, Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
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
    /** Tentativas e espera; o padrão é o de todo job (3, exponencial). */
    options?: Pick<JobsOptions, 'attempts' | 'backoff'>;
    /**
     * Guarda no Mongo para o worker reaplicar ao subir. Só `false` na própria
     * reaplicação, que lê de lá.
     */
    persistir?: boolean;
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
      {
        name: input.job,
        data: body,
        opts: { ...DEFAULT_OPTIONS, ...input.options },
      },
    );

    if (input.persistir !== false) {
      await this.prisma()
        ?.taskSchedule.upsert({
          where: { schedulerId: input.schedulerId },
          create: {
            schedulerId: input.schedulerId,
            queue: input.queue,
            job: input.job,
            cron: input.cron,
            timezone: input.timezone,
            payload: (input.payload ?? {}) as Prisma.InputJsonValue,
            requestedBy: input.requestedBy ?? null,
            options: (input.options ?? {}) as Prisma.InputJsonValue,
            enabled: true,
          },
          update: {
            queue: input.queue,
            job: input.job,
            cron: input.cron,
            timezone: input.timezone,
            payload: (input.payload ?? {}) as Prisma.InputJsonValue,
            requestedBy: input.requestedBy ?? null,
            options: (input.options ?? {}) as Prisma.InputJsonValue,
            enabled: true,
          },
        })
        .catch((error: unknown) =>
          this.logger.error(
            `Agendamento ${input.schedulerId} não foi guardado no banco: ${String(error)}`,
          ),
        );
    }

    this.logger.log(
      `Agendamento salvo: ${input.queue}/${input.schedulerId} (${input.cron} ${input.timezone})`,
    );
  }

  /**
   * O Prisma, achado sem injeção: este serviço é global e montado também em
   * testes que não têm banco. Sem ele, o agendamento vale só no Redis.
   */
  private prisma(): PrismaService | null {
    try {
      const prisma = this.moduleRef.get(PrismaService, { strict: false });
      return prisma && 'taskSchedule' in prisma ? prisma : null;
    } catch {
      return null;
    }
  }

  /**
   * Reaplica no Redis todo agendamento ativo guardado no Mongo — o que o
   * worker faz ao subir. Antes, os agendamentos de manutenção e de scraper
   * existiam só no Redis, que salva em disco no máximo a cada hora: um Redis
   * recriado os perdia sem aviso. O agendamento que só está no Redis (criado
   * antes disto) é trazido para o Mongo, com a carga que o próprio Redis
   * guarda.
   */
  async reaplicarAgendamentos(filas: readonly QueueName[]): Promise<number> {
    const prisma = this.prisma();
    if (!prisma) return 0;

    for (const fila of filas) {
      const vivos = await this.queue(fila).getJobSchedulers();
      for (const vivo of vivos) {
        const guardado = await prisma.taskSchedule.findUnique({
          where: { schedulerId: vivo.key },
        });
        const dados = vivo.template?.data as JobEnvelope<unknown> | undefined;
        if (!guardado && vivo.pattern && vivo.name) {
          await prisma.taskSchedule.create({
            data: {
              schedulerId: vivo.key,
              queue: fila,
              job: vivo.name,
              cron: vivo.pattern,
              timezone: vivo.tz ?? 'America/Sao_Paulo',
              payload: (dados?.payload ?? {}) as Prisma.InputJsonValue,
              requestedBy: dados?.requestedBy ?? null,
              enabled: true,
            },
          });
        }
      }
    }

    const ativos = await prisma.taskSchedule.findMany({
      where: { enabled: true, queue: { in: [...filas] } },
    });
    for (const a of ativos) {
      await this.upsertSchedule({
        queue: a.queue as QueueName,
        schedulerId: a.schedulerId,
        cron: a.cron,
        timezone: a.timezone,
        job: a.job,
        payload: a.payload,
        requestedBy: a.requestedBy,
        options: (a.options ?? undefined) as
          | Pick<JobsOptions, 'attempts' | 'backoff'>
          | undefined,
        persistir: false,
      });
    }

    return ativos.length;
  }

  /**
   * Cria o agendamento só se ele nunca existiu. Removido por alguém
   * (`enabled: false`), continua removido — o padrão não volta sozinho.
   */
  async agendarSeNuncaExistiu<TPayload>(
    input: Parameters<QueueService['upsertSchedule']>[0] & {
      payload: TPayload;
    },
  ): Promise<boolean> {
    const prisma = this.prisma();
    if (!prisma) return false;

    const existe = await prisma.taskSchedule.findUnique({
      where: { schedulerId: input.schedulerId },
      select: { id: true },
    });
    if (existe) return false;

    await this.upsertSchedule(input);
    return true;
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

    // Fica guardado como desligado: é o que impede o worker de recriá-lo ao
    // subir (o padrão das limpezas só entra quando nunca existiu).
    await this.prisma()
      ?.taskSchedule.updateMany({
        where: { schedulerId },
        data: { enabled: false },
      })
      .catch(() => undefined);

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
