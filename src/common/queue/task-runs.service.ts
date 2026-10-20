import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { errorMessage } from '../utils/error.util';
import type { JobEnvelope } from './job-contract';

/** O que uma execução deixa registrado, além de quando e de quem. */
export interface RelatoDaExecucao {
  summary?: Record<string, unknown>;
  sample?: string[];
  warnings?: string[];
  dryRun?: boolean;
}

export interface TarefaRastreada<T> {
  queue: string;
  task: string;
  taskName: string;
  /** Tira do resultado o que vai para o histórico. */
  relato?: (resultado: T) => RelatoDaExecucao;
  /**
   * Grava esta execução? Para as varreduras de minuto em minuto, só quando
   * fizeram algo: mil linhas por dia dizendo "nada a fazer" é poluição.
   * Falha é sempre gravada.
   */
  gravar?: (resultado: T) => boolean;
}

/** Amostra e avisos têm teto: o histórico não é depósito de relatório. */
const MAX_AMOSTRA = 50;

export interface FiltroDeExecucoes {
  task?: string;
  trigger?: 'agendado' | 'manual';
  status?: 'ok' | 'falhou';
  from?: string;
  to?: string;
}

/**
 * O histórico de execuções das tarefas (`task_runs`), no Mongo.
 *
 * O Redis guarda os jobs concluídos por sete dias e no máximo mil por fila —
 * e a publicação de artigos, que roda a cada minuto, renovava esse limite em
 * menos de um dia, levando junto o histórico das outras varreduras. Aqui fica
 * a execução que importa, com quem disparou e o que mudou.
 */
@Injectable()
export class TaskRunsService {
  private readonly logger = new Logger(TaskRunsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Roda `executar` e grava a execução. O erro é gravado e relançado: a fila
   * continua decidindo se tenta de novo.
   */
  async rastrear<T>(
    job: Job<JobEnvelope<unknown>>,
    tarefa: TarefaRastreada<T>,
    executar: () => Promise<T>,
  ): Promise<T> {
    const inicio = new Date();

    try {
      const resultado = await executar();

      if (!tarefa.gravar || tarefa.gravar(resultado)) {
        await this.gravar(job, tarefa, inicio, {
          status: 'ok',
          ...(tarefa.relato?.(resultado) ?? {}),
        });
      }

      return resultado;
    } catch (error: unknown) {
      await this.gravar(job, tarefa, inicio, {
        status: 'falhou',
        error: errorMessage(error).slice(0, 1000),
      });
      throw error;
    }
  }

  private async gravar(
    job: Job<JobEnvelope<unknown>>,
    tarefa: Pick<TarefaRastreada<unknown>, 'queue' | 'task' | 'taskName'>,
    inicio: Date,
    dados: RelatoDaExecucao & { status: 'ok' | 'falhou'; error?: string },
  ): Promise<void> {
    const fim = new Date();
    // Job criado por agendamento traz a chave do agendador; o disparado à mão,
    // não. O `requestedBy` do envelope de um agendado é quem criou o
    // agendamento, não quem rodou — por isso só vale no manual.
    const agendado = !!job.repeatJobKey || String(job.id).startsWith('repeat:');

    try {
      await this.prisma.taskRun.create({
        data: {
          queue: tarefa.queue,
          task: tarefa.task,
          taskName: tarefa.taskName,
          trigger: agendado ? 'agendado' : 'manual',
          requestedBy: agendado ? null : (job.data?.requestedBy ?? null),
          jobId: String(job.id ?? ''),
          attempt: (job.attemptsMade ?? 0) + 1,
          status: dados.status,
          dryRun: dados.dryRun ?? false,
          startedAt: inicio,
          finishedAt: fim,
          durationMs: fim.getTime() - inicio.getTime(),
          summary: (dados.summary ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
          sample: (dados.sample ?? []).slice(0, MAX_AMOSTRA),
          warnings: (dados.warnings ?? []).slice(0, MAX_AMOSTRA),
          error: dados.error ?? null,
        },
      });
    } catch (error: unknown) {
      // Falhar ao registrar não pode derrubar a tarefa que já rodou.
      this.logger.error(
        `Execução de ${tarefa.task} não foi registrada: ${errorMessage(error)}`,
      );
    }
  }

  private where(filtro: FiltroDeExecucoes): Prisma.TaskRunWhereInput {
    return {
      ...(filtro.task ? { task: filtro.task } : {}),
      ...(filtro.trigger ? { trigger: filtro.trigger } : {}),
      ...(filtro.status ? { status: filtro.status } : {}),
      ...(filtro.from || filtro.to
        ? {
            startedAt: {
              ...(filtro.from ? { gte: new Date(filtro.from) } : {}),
              ...(filtro.to ? { lte: new Date(filtro.to) } : {}),
            },
          }
        : {}),
    };
  }

  async listar(filtro: FiltroDeExecucoes, page = 1, limit = 30) {
    const where = this.where(filtro);
    const [items, total] = await Promise.all([
      this.prisma.taskRun.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.taskRun.count({ where }),
    ]);

    // Quem disparou, pelo nome, para a tela não buscar conta por conta.
    const ids = [
      ...new Set(items.map((r) => r.requestedBy).filter(Boolean)),
    ] as string[];
    const pessoas = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            email: true,
          },
        })
      : [];
    const nome = new Map(
      pessoas.map((p) => [
        p.id,
        [p.firstName, p.lastName].filter(Boolean).join(' ') ||
          p.username ||
          p.email,
      ]),
    );

    return {
      items: items.map((r) => ({
        ...r,
        requestedByName: r.requestedBy
          ? (nome.get(r.requestedBy) ?? 'Conta removida')
          : null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  /** Por tarefa: quantas vezes rodou, a última, falhas, agendadas e manuais. */
  async resumo() {
    const grupos = await this.prisma.taskRun.aggregateRaw({
      pipeline: [
        { $sort: { startedAt: -1 } },
        {
          $group: {
            _id: '$task',
            nome: { $first: '$taskName' },
            total: { $sum: 1 },
            falhas: { $sum: { $cond: [{ $eq: ['$status', 'falhou'] }, 1, 0] } },
            agendadas: {
              $sum: { $cond: [{ $eq: ['$trigger', 'agendado'] }, 1, 0] },
            },
            ultimaEm: { $first: '$startedAt' },
            ultimoStatus: { $first: '$status' },
            ultimoGatilho: { $first: '$trigger' },
          },
        },
      ],
    });

    const linhas = grupos as unknown as Array<{
      _id: string;
      nome: string;
      total: number;
      falhas: number;
      agendadas: number;
      ultimaEm: { $date: string } | string;
      ultimoStatus: string;
      ultimoGatilho: string;
    }>;

    return linhas.map((g) => ({
      task: g._id,
      taskName: g.nome,
      total: g.total,
      falhas: g.falhas,
      agendadas: g.agendadas,
      manuais: g.total - g.agendadas,
      ultimaEm: typeof g.ultimaEm === 'string' ? g.ultimaEm : g.ultimaEm.$date,
      ultimoStatus: g.ultimoStatus,
      ultimoGatilho: g.ultimoGatilho,
    }));
  }

  /**
   * Apaga registros do histórico: os escolhidos, ou todos de uma tarefa (ou
   * de todas) antes de uma data. Sem nenhum dos dois, não apaga nada.
   */
  async apagar(input: { ids?: string[]; before?: string; task?: string }) {
    if (input.ids?.length) {
      const r = await this.prisma.taskRun.deleteMany({
        where: { id: { in: input.ids } },
      });
      return { apagados: r.count };
    }

    if (input.before) {
      const r = await this.prisma.taskRun.deleteMany({
        where: {
          startedAt: { lt: new Date(input.before) },
          ...(input.task ? { task: input.task } : {}),
        },
      });
      return { apagados: r.count };
    }

    return { apagados: 0 };
  }
}
