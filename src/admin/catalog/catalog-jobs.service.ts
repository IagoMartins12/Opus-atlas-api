import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CatalogJobRun, Prisma } from '@prisma/client';
import {
  CATALOG_JOBS,
  CatalogJobDef,
  findCatalogJob,
  isCatalogJobId,
} from '../../catalog/jobs/catalog-jobs';
import type { JobArgs, JobLogger } from '../../catalog/jobs/job-types';
import {
  CacheNamespace,
  CATALOG_NAMESPACES,
} from '../../common/cache/cache-keys';
import { AppCacheService } from '../../common/cache/cache.service';
import {
  JOB_CATALOG_RUN,
  QUEUE_CATALOG,
} from '../../common/queue/queue.constants';
import { QueueService } from '../../common/queue/queue.service';
import { errorMessage } from '../../common/utils/error.util';
import { PrismaService } from '../../prisma/prisma.service';

/** Sem sinal do worker por este tempo, a execução é dada como interrompida. */
const STALE_MS = 2 * 60 * 1000;
/** Quanto o worker demora a gravar progresso e log. */
const FLUSH_MS = 4000;
const LOG_LINES = 300;
const LOG_WIDTH = 500;

export interface CatalogJobPayload {
  runId: string;
}

export interface StartCatalogJobInput {
  apply: boolean;
  confirm?: boolean;
  limit?: number;
  pause?: number;
}

const ACTIVE = ['queued', 'running'];

/**
 * As rotinas do acervo no painel: dispara, acompanha e para.
 *
 * A execução acontece no worker (`CatalogJobsProcessor` chama `execute`), não
 * na requisição: uma rotina pode levar horas. Este serviço escreve o estado
 * em `CatalogJobRun` e o painel o lê de tempos em tempos.
 */
@Injectable()
export class CatalogJobsService {
  private readonly logger = new Logger(CatalogJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly cache: AppCacheService,
  ) {}

  // ------------------------------------------------------------ painel

  /** As rotinas, cada uma com a última execução e a que está em andamento. */
  async list() {
    await this.markStale();
    const runs = await this.prisma.catalogJobRun.findMany({
      orderBy: { queuedAt: 'desc' },
      take: 200,
    });
    return CATALOG_JOBS.map((job) => {
      const mine = runs.filter((r) => r.job === job.id);
      return {
        id: job.id,
        name: job.name,
        description: job.description,
        group: job.group,
        destructive: job.destructive,
        slow: job.slow,
        external: job.external,
        params: job.params,
        active: mine.find((r) => ACTIVE.includes(r.status)) ?? null,
        last: mine.find((r) => !ACTIVE.includes(r.status)) ?? null,
      };
    }).map((j) => ({
      ...j,
      active: j.active ? this.toView(j.active, false) : null,
      last: j.last ? this.toView(j.last, false) : null,
    }));
  }

  async history(jobId: string, limit = 15) {
    if (!isCatalogJobId(jobId))
      throw new NotFoundException('Rotina desconhecida');
    await this.markStale();
    const runs = await this.prisma.catalogJobRun.findMany({
      where: { job: jobId },
      orderBy: { queuedAt: 'desc' },
      take: limit,
    });
    return runs.map((r) => this.toView(r, false));
  }

  async get(runId: string) {
    await this.markStale();
    const run = await this.prisma.catalogJobRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw new NotFoundException('Execução não encontrada');
    return this.toView(run, true);
  }

  async start(
    jobId: string,
    input: StartCatalogJobInput,
    requestedBy: string | null,
  ) {
    if (!isCatalogJobId(jobId))
      throw new NotFoundException('Rotina desconhecida');
    const job = findCatalogJob(jobId);

    if (input.apply && job.destructive && !input.confirm)
      throw new BadRequestException(
        'Esta rotina junta ou apaga registros. Para gravar, confirme (`confirm: true`); antes, rode a simulação e leia o resultado.',
      );

    await this.markStale();
    const running = await this.prisma.catalogJobRun.findFirst({
      where: { status: { in: ACTIVE } },
    });
    // Uma por vez: as rotinas mexem nas mesmas coleções e a fila é de uma só.
    if (running)
      throw new ConflictException(
        `Já há uma rotina em andamento (${running.jobName}). Espere terminar ou peça para parar.`,
      );

    const args: JobArgs = {};
    if (input.limit !== undefined && job.params.some((p) => p.key === 'limit'))
      args.limit = input.limit;
    if (input.pause !== undefined && job.params.some((p) => p.key === 'pause'))
      args.pause = input.pause;

    const run = await this.prisma.catalogJobRun.create({
      data: {
        job: job.id,
        jobName: job.name,
        status: 'queued',
        apply: input.apply,
        args: args as Prisma.InputJsonValue,
        requestedBy,
      },
    });

    try {
      await this.queue.enqueue<CatalogJobPayload>({
        queue: QUEUE_CATALOG,
        job: JOB_CATALOG_RUN,
        idempotencyKey: `catalog.run.${run.id}`,
        payload: { runId: run.id },
        requestedBy,
        options: { attempts: 1 },
      });
    } catch (error: unknown) {
      await this.prisma.catalogJobRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          error: `Não foi possível enfileirar: ${errorMessage(error)}`,
          finishedAt: new Date(),
        },
      });
      throw error;
    }
    return this.toView(run, false);
  }

  /** Pede para parar; a rotina encerra no próximo passo e fica "parada". */
  async stop(runId: string) {
    const run = await this.prisma.catalogJobRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw new NotFoundException('Execução não encontrada');
    if (!ACTIVE.includes(run.status)) return this.toView(run, false);
    const updated = await this.prisma.catalogJobRun.update({
      where: { id: runId },
      data: { stopRequested: true },
    });
    return this.toView(updated, false);
  }

  // ------------------------------------------------------------ worker

  /**
   * Roda a execução (chamado pelo worker). Atualiza progresso e log de tempos
   * em tempos e fecha com o resultado; nunca lança — o estado fica no banco.
   */
  async execute(runId: string): Promise<void> {
    const run = await this.prisma.catalogJobRun.findUnique({
      where: { id: runId },
    });
    if (!run || run.status !== 'queued') return;
    const job = findCatalogJob(run.job);

    if (run.stopRequested) {
      await this.finish(runId, 'stopped', { error: null });
      return;
    }

    const lines: string[] = [];
    const push = (level: string, message: unknown) => {
      const text = `${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })} ${level}${String(message)}`;
      lines.push(text.slice(0, LOG_WIDTH));
      if (lines.length > LOG_LINES) lines.shift();
    };
    const logger: JobLogger = {
      log: (m: unknown) => {
        this.logger.log(`[${job.id}] ${String(m)}`);
        push('', m);
      },
      warn: (m: unknown) => {
        this.logger.warn(`[${job.id}] ${String(m)}`);
        push('AVISO ', m);
      },
      error: (m: unknown) => {
        this.logger.error(`[${job.id}] ${String(m)}`);
        push('ERRO ', m);
      },
    };

    let done = 0;
    let total: number | null = null;
    let message: string | null = null;
    let stopRequested = false;
    const progress = (d: number, t?: number, m?: string) => {
      done = d;
      if (t !== undefined) total = t;
      if (m !== undefined) message = m;
    };

    await this.prisma.catalogJobRun.update({
      where: { id: runId },
      data: {
        status: 'running',
        startedAt: new Date(),
        heartbeatAt: new Date(),
      },
    });

    const flush = async () => {
      try {
        const fresh = await this.prisma.catalogJobRun.update({
          where: { id: runId },
          data: {
            heartbeatAt: new Date(),
            progressDone: done,
            progressTotal: total,
            progressMessage: message,
            log: [...lines],
          },
          select: { stopRequested: true },
        });
        stopRequested = fresh.stopRequested;
      } catch (error: unknown) {
        this.logger.warn(`Não gravou o progresso: ${errorMessage(error)}`);
      }
    };
    const timer = setInterval(() => void flush(), FLUSH_MS);

    try {
      logger.log(
        run.apply ? 'Gravando (modo aplicar)' : 'Simulação: nada é gravado',
      );
      const outcome = await job.work({
        prisma: this.prisma,
        apply: run.apply,
        logger,
        args: (run.args ?? {}) as JobArgs,
        progress,
        shouldStop: () => stopRequested,
      });
      if (run.apply)
        await this.cache.invalidateMany([
          ...CATALOG_NAMESPACES,
          CacheNamespace.COLLECTIONS,
        ]);
      clearInterval(timer);
      await flush();
      await this.finish(runId, stopRequested ? 'stopped' : 'ok', {
        summary: outcome?.summary,
        sample: outcome?.sample,
        warnings: outcome?.warnings,
        lines,
        done,
        total,
      });
    } catch (error: unknown) {
      clearInterval(timer);
      const text = errorMessage(error);
      logger.error(text);
      // Parada ou falha no meio já gravou parte: o site precisa ver o que mudou.
      if (run.apply)
        await this.cache
          .invalidateMany([...CATALOG_NAMESPACES, CacheNamespace.COLLECTIONS])
          .catch(() => undefined);
      await this.finish(
        runId,
        stopRequested || text === 'Parada pedida' ? 'stopped' : 'failed',
        { error: text, lines, done, total },
      );
    }
  }

  private async finish(
    runId: string,
    status: 'ok' | 'failed' | 'stopped',
    extra: {
      summary?: Record<string, number | string>;
      sample?: string[];
      warnings?: string[];
      error?: string | null;
      lines?: string[];
      done?: number;
      total?: number | null;
    },
  ) {
    await this.prisma.catalogJobRun.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: new Date(),
        ...(extra.summary
          ? { summary: extra.summary as Prisma.InputJsonValue }
          : {}),
        sample: extra.sample ?? [],
        warnings: extra.warnings ?? [],
        error: extra.error ?? null,
        ...(extra.lines ? { log: extra.lines } : {}),
        ...(extra.done !== undefined ? { progressDone: extra.done } : {}),
        ...(extra.total !== undefined ? { progressTotal: extra.total } : {}),
      },
    });
  }

  /** Quem parou de dar sinal (worker caiu) deixa de parecer "em andamento". */
  private async markStale() {
    const limit = new Date(Date.now() - STALE_MS);
    await this.prisma.catalogJobRun.updateMany({
      where: {
        status: 'running',
        OR: [{ heartbeatAt: { lt: limit } }, { heartbeatAt: null }],
      },
      data: {
        status: 'interrupted',
        finishedAt: new Date(),
        error: 'O worker parou de responder no meio da execução.',
      },
    });
  }

  private toView(run: CatalogJobRun, withLog: boolean) {
    return {
      id: run.id,
      job: run.job,
      jobName: run.jobName,
      status: run.status,
      apply: run.apply,
      args: run.args,
      stopRequested: run.stopRequested,
      progress: {
        done: run.progressDone,
        total: run.progressTotal,
        message: run.progressMessage,
      },
      summary: run.summary,
      sample: run.sample,
      warnings: run.warnings,
      error: run.error,
      queuedAt: run.queuedAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      heartbeatAt: run.heartbeatAt,
      ...(withLog ? { log: run.log } : {}),
    };
  }
}

export type CatalogJobView =
  ReturnType<CatalogJobsService['get']> extends Promise<infer T> ? T : never;
export type { CatalogJobDef };
