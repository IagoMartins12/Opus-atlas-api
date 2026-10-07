import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, QueueName } from './queue.constants';
import { JobEnvelope } from './job-contract';
import { JobProgress, readProgress } from './job-progress';

export interface JobStatusView {
  queue: QueueName;
  jobId: string;
  job: string;
  /** `waiting`, `delayed`, `active`, `completed`, `failed`, `unknown`. */
  state: string;
  /** Percentual e frase, quando o processor reporta; `null` quando não. */
  progress: JobProgress | null;
  attemptsMade: number;
  requestedBy: string | null;
  requestedAt: string | null;
  /** O que o job recebeu (a casa, a tarefa). Só na listagem de recentes. */
  payload?: unknown;
  processedAt: Date | null;
  finishedAt: Date | null;
  /** O que o processor devolveu. Só existe em `completed`. */
  result: unknown;
  failedReason: string | null;
}

export interface QueueHealthView {
  queue: QueueName;
  paused: boolean;
  /**
   * Quantos workers estão conectados nesta fila.
   *
   * **Zero é o alarme.** É exatamente o que acontece quando o cluster sobe só
   * com a imagem `api`: as rotas respondem 202, os jobs entram, a fila de
   * espera cresce, e nada nunca é processado. Sem este número, o sintoma
   * aparece dias depois como "a campanha não saiu".
   */
  workers: number;
  counts: {
    waiting: number;
    active: number;
    delayed: number;
    completed: number;
    failed: number;
  };
  /** Idade do job mais antigo esperando, em segundos. Mede atraso real. */
  oldestWaitingSeconds: number | null;
}

const isEnvelope = (value: unknown): value is JobEnvelope<unknown> =>
  typeof value === 'object' && value !== null && 'idempotencyKey' in value;

/**
 * Leitura do estado da fila.
 *
 * **O BullMQ é a fonte da verdade, e não há tabela espelho.** A alternativa
 * seria um modelo `JobRun` no Prisma atualizado pelo processor — e aí passam a
 * existir dois lugares que sabem o estado do job, que discordam exatamente
 * quando o worker morre no meio, que é quando a resposta importa.
 *
 * O preço é a retenção: job concluído some depois de sete dias, falha depois
 * de trinta. Para o que o administrador precisa saber ("o backup de ontem
 * rodou?") isso sobra; para prova permanente de ação administrativa existe o
 * `AdminAuditLog`, que registra o **pedido** e nunca expira.
 */
@Injectable()
export class JobStatusService {
  private readonly resolved = new Map<QueueName, Queue>();

  constructor(private readonly moduleRef: ModuleRef) {}

  async describe(
    queueName: QueueName,
    jobId: string,
  ): Promise<JobStatusView | null> {
    const job = await this.queue(queueName).getJob(jobId);

    if (!job) {
      return null;
    }

    const state = await job.getState();
    const body = job.data as unknown;

    return {
      queue: queueName,
      jobId: job.id ?? jobId,
      job: job.name,
      state,
      progress: readProgress(job.progress),
      attemptsMade: job.attemptsMade,
      requestedBy: isEnvelope(body) ? body.requestedBy : null,
      requestedAt: isEnvelope(body) ? body.requestedAt : null,
      processedAt: job.processedOn ? new Date(job.processedOn) : null,
      finishedAt: job.finishedOn ? new Date(job.finishedOn) : null,
      result: state === 'completed' ? semBruto(job.returnvalue) : null,
      failedReason: job.failedReason ?? null,
    };
  }

  /**
   * O resultado inteiro de um job concluído, com o que `describe` esconde
   * (os eventos lidos de uma prévia). Para quem vai usar o dado, não para a
   * tela que acompanha o andamento.
   */
  async resultadoCompleto(
    queueName: QueueName,
    jobId: string,
  ): Promise<{ state: string; result: unknown } | null> {
    const job = await this.queue(queueName).getJob(jobId);
    if (!job) return null;

    return { state: await job.getState(), result: job.returnvalue };
  }

  /** Saúde de todas as filas registradas neste processo. */
  async health(): Promise<QueueHealthView[]> {
    return Promise.all(QUEUE_NAMES.map((name) => this.healthOf(name)));
  }

  /**
   * Últimas falhas de uma fila.
   *
   * É a tela que responde "o que quebrou", sem obrigar a abrir job por job.
   */
  async failures(queueName: QueueName, limit = 20) {
    const jobs = await this.queue(queueName).getFailed(
      0,
      Math.max(0, limit - 1),
    );

    return jobs.map((job) => {
      const body = job.data as unknown;

      return {
        jobId: job.id ?? null,
        job: job.name,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason ?? null,
        requestedBy: isEnvelope(body) ? body.requestedBy : null,
        failedAt: job.finishedOn ? new Date(job.finishedOn) : null,
      };
    });
  }

  /**
   * As rodadas mais recentes de uma fila — em andamento, esperando, feitas e
   * falhas —, as mais novas primeiro. É o que as telas de scraper e de
   * manutenção mostram como "últimas rodadas", com o resultado de cada uma.
   * `job` filtra por nome do job (ex.: uma tarefa de manutenção só).
   */
  async recent(
    queueName: QueueName,
    limit = 20,
    jobName?: string,
  ): Promise<JobStatusView[]> {
    // Lê mais que o pedido quando filtra por nome: o filtro é depois.
    const janela = jobName ? Math.min(limit * 10, 500) : limit;
    const jobs = await this.queue(queueName).getJobs(
      ['active', 'waiting', 'delayed', 'completed', 'failed'],
      0,
      Math.max(0, janela - 1),
      false,
    );

    const vistos = await Promise.all(
      jobs
        .filter(
          (job) =>
            !jobName || job.name === jobName || jobDataName(job) === jobName,
        )
        .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
        .slice(0, limit)
        .map(async (job) => {
          const state = await job.getState();
          const body = job.data as unknown;
          return {
            queue: queueName,
            jobId: job.id ?? '',
            job: job.name,
            state,
            progress: readProgress(job.progress),
            attemptsMade: job.attemptsMade,
            requestedBy: isEnvelope(body) ? body.requestedBy : null,
            requestedAt: isEnvelope(body) ? body.requestedAt : null,
            processedAt: job.processedOn ? new Date(job.processedOn) : null,
            finishedAt: job.finishedOn ? new Date(job.finishedOn) : null,
            result: state === 'completed' ? semBruto(job.returnvalue) : null,
            failedReason: job.failedReason ?? null,
            payload: isEnvelope(body) ? body.payload : null,
          };
        }),
    );
    return vistos;
  }

  private async healthOf(queueName: QueueName): Promise<QueueHealthView> {
    const queue = this.queue(queueName);

    const [counts, paused, workers, waiting] = await Promise.all([
      queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed'),
      queue.isPaused(),
      queue.getWorkers(),
      queue.getWaiting(0, 0),
    ]);

    const oldest = waiting[0]?.timestamp ?? null;

    return {
      queue: queueName,
      paused,
      workers: workers.length,
      counts: {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
      },
      oldestWaitingSeconds:
        oldest === null ? null : Math.floor((Date.now() - oldest) / 1000),
    };
  }

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

/** O nome "de dentro" do job (ex.: a tarefa de manutenção), quando há. */
function jobDataName(job: { data: unknown }): string | null {
  const body = job.data as unknown;
  if (!isEnvelope(body)) return null;
  const payload = body.payload as Record<string, unknown> | null;
  const nome = payload?.taskId ?? payload?.scraperId;
  return typeof nome === 'string' ? nome : null;
}

/**
 * Tira do resultado o que é dado bruto: a prévia do scraper guarda até 300
 * eventos completos em `lidos`, e a tela que acompanha a rodada consulta o job
 * a cada segundo e meio — mandar isso toda vez seria centenas de KB à toa.
 */
function semBruto(resultado: unknown): unknown {
  if (resultado && typeof resultado === 'object' && 'lidos' in resultado) {
    const { lidos: _lidos, ...resto } = resultado as Record<string, unknown>;
    return resto;
  }
  return resultado;
}
