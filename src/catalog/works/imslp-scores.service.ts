import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma, ScoreSource } from '@prisma/client';
import { Queue } from 'bullmq';
import { isMongoId } from 'class-validator';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace } from '../../common/cache/cache-keys';
import { buildIdempotencyKey, envelope } from '../../common/queue/job-contract';
import {
  JOB_IMSLP_SCORES,
  QUEUE_IMSLP,
} from '../../common/queue/queue.constants';
import { errorMessage } from '../../common/utils/error.util';
import { PrismaService } from '../../prisma/prisma.service';
import { ExternalPageFetcher } from '../../scrapers/imslp/external-page.fetcher';
import {
  ParsedImslpScore,
  parseImslpScores,
} from '../../scrapers/imslp/imslp-scores.parser';

/**
 * Situação das partituras do IMSLP de uma obra, como a página da obra a vê.
 *
 * - `stored`: já estão no banco (ou a obra tem partitura de outra fonte);
 * - `pending`: a busca está na fila ou rodando — a tela mostra o aviso e
 *   pergunta de novo em `GET /works/:id/scores/imslp-status`;
 * - `none`: o IMSLP não tem arquivo para a obra (ou ela não tem página lá);
 * - `unavailable`: não deu para buscar agora (IMSLP fora, fila cheia, robô).
 */
export type ImslpStatus = 'stored' | 'pending' | 'none' | 'unavailable';

/** Obra lida não é lida de novo por um dia — nem a que não tem arquivo. */
const TRIED_TTL_MS = 24 * 60 * 60 * 1000;

/** Falha (IMSLP fora, página mudou) tenta de novo mais cedo. */
const FAILED_TTL_MS = 60 * 60 * 1000;

/**
 * Teto da fila. Com o limitador abaixo, 300 obras esperando são ~8 minutos de
 * trabalho; acima disso é pico (ou robô que escapou do filtro), e enfileirar
 * mais só faz a pessoa esperar por nada. Quem chega com a fila cheia vê
 * "indisponível agora" e a próxima visita tenta.
 */
const MAX_BACKLOG = 300;

/** Falhas seguidas que abrem o disjuntor, e por quanto tempo ele fica aberto. */
const BREAKER_THRESHOLD = 5;
const BREAKER_WINDOW_MS = 5 * 60 * 1000;
const BREAKER_OPEN_MS = 10 * 60 * 1000;

/** Trava por obra: a busca da fila e o "reler" do admin não rodam juntos. */
const LOCK_TTL_MS = 60 * 1000;

/** Um "procurar novamente" por obra a cada minuto: botão apertado em série não fura a fila em série. */
const RETRY_COOLDOWN_MS = 60 * 1000;

/**
 * O endereço de uma obra no IMSLP: uma página do wiki, e não uma categoria
 * (a do compositor) nem uma busca. Fora disso nada é pedido ao IMSLP.
 */
const IMSLP_WORK_PAGE =
  /^https?:\/\/(www\.)?imslp\.org\/wiki\/(?!Category:|Special:Search)[^\s?#]+/i;

// Fora dos namespaces de cache de propósito: uma escrita no catálogo limpa
// `works:*`, e a marca de tentativa não deve sumir junto.
/**
 * O `jobId` da leitura de uma obra: um por obra, e **sem `:`**.
 *
 * O BullMQ recusa `:` num `jobId` ("Custom Id cannot contain :"). Aqui ele
 * estava escrito à mão como `imslp-scores:<id>` — fora do contrato de jobs
 * (`buildIdempotencyKey`, que usa pontos) — e **toda** leitura lançava, o
 * erro era engolido como "indisponível" e nenhuma partitura do IMSLP chegava
 * a ser buscada. Os testes usavam fila simulada e não viam: ver o teste que
 * valida o id com a regra de verdade do BullMQ.
 */
export const imslpScoresJobId = (workId: string) =>
  buildIdempotencyKey('imslp.scores', workId);

const triedKey = (workId: string) => `imslp-scores:tried:${workId}`;
const lockKey = (workId: string) => `imslp-scores:lock:${workId}`;
const retryKey = (workId: string) => `imslp-scores:retry:${workId}`;
const BREAKER_FAILURES = 'imslp-scores:breaker:failures';
const BREAKER_OPEN = 'imslp-scores:breaker:open';

/** O que a marca de tentativa guarda: deu certo (com ou sem arquivo) ou falhou. */
type TriedMark = 'done' | 'failed';

export interface ImslpScoresJobPayload {
  workId: string;
}

/** O mínimo do cliente Redis que este serviço usa (o do BullMQ, ioredis). */
interface RedisLike {
  set(
    key: string,
    value: string,
    px: 'PX',
    ttl: number,
    nx: 'NX',
  ): Promise<'OK' | null>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  pexpire(key: string, ttl: number): Promise<number>;
}

/**
 * Partituras do IMSLP sob demanda.
 *
 * **Por que existe.** Das 207 mil obras, só 11% têm partitura guardada; as
 * outras são lidas do IMSLP na primeira visita e gravadas.
 *
 * **Por que numa fila (01/10).** Até aqui a leitura acontecia dentro da
 * requisição da página: a pessoa esperava o IMSLP, a trava era só em memória
 * (N réplicas = N vezes o teto), e um robô varrendo obras disparava uma
 * raspagem por página. Agora:
 *
 * - a rota só **pede** (`request`) e responde na hora com a situação;
 * - o pedido vira um job com `jobId` por obra — o BullMQ não aceita dois jobs
 *   com o mesmo id, então mil visitas simultâneas à mesma obra, em qualquer
 *   réplica, viram uma raspagem só;
 * - quem raspa é o worker (`ImslpScoresProcessor`), com um limitador **da
 *   fila** (vale somando todos os workers) — o IMSLP é de terceiros e público;
 * - um disjuntor no Redis para de tentar quando o IMSLP falha seguidamente;
 * - robô não pede: lê o que já está guardado.
 */
@Injectable()
export class ImslpScoresService {
  private readonly logger = new Logger(ImslpScoresService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fetcher: ExternalPageFetcher,
    private readonly cache: AppCacheService,
    @InjectQueue(QUEUE_IMSLP) private readonly queue: Queue,
  ) {}

  /**
   * Situação das partituras da obra; se ainda não foram lidas e a visita é de
   * uma pessoa, enfileira a leitura. Nunca lança: o IMSLP (ou o Redis) fora
   * não pode derrubar a página da obra.
   */
  async request(
    workId: string,
    options: { robot?: boolean } = {},
  ): Promise<ImslpStatus> {
    try {
      const known = await this.knownStatus(workId);
      if (known) return known;

      if (options.robot) return 'unavailable';
      if (await this.breakerOpen()) return 'unavailable';
      if ((await this.queue.getWaitingCount()) >= MAX_BACKLOG) {
        return 'unavailable';
      }

      // `jobId` fixo por obra: se já existe um job com ele, o `add` não cria
      // outro — é a trava global contra a mesma obra raspada duas vezes.
      // Concluído ou falho, o job sai da fila (`removeOn*`), e quem impede uma
      // nova leitura no mesmo dia é a marca de tentativa.
      await this.queue.add(
        JOB_IMSLP_SCORES,
        envelope<ImslpScoresJobPayload>({
          idempotencyKey: imslpScoresJobId(workId),
          payload: { workId },
        }),
        {
          jobId: imslpScoresJobId(workId),
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      return 'pending';
    } catch (error: unknown) {
      this.logger.warn(
        `IMSLP: não foi possível pedir as partituras da obra ${workId}: ${errorMessage(error)}`,
      );
      return 'unavailable';
    }
  }

  /**
   * "Procurar novamente": a obra que ficou sem resposta (fila cheia, espera
   * longa) volta à fila **na frente de todas** (`lifo`) — o job que já
   * esperava sai e entra de novo no começo. Não fura o disjuntor (o IMSLP
   * falhando continua em pausa), não busca obra sem página no IMSLP nem a
   * que já foi lida hoje, e vale uma vez por minuto por obra. Nunca lança.
   */
  async searchAgain(
    workId: string,
    options: { robot?: boolean } = {},
  ): Promise<ImslpStatus> {
    try {
      if (!isMongoId(workId)) return 'none';
      if ((await this.storedCount(workId)) > 0) return 'stored';
      if (!(await this.permlinkOf(workId))) return 'none';
      const mark = await this.cache.get<TriedMark | boolean>(triedKey(workId));
      if (mark === 'done' || mark === true) return 'none';
      if (options.robot || (await this.breakerOpen())) return 'unavailable';

      const redis = await this.redis();
      const id = imslpScoresJobId(workId);
      if (
        !(await redis.set(retryKey(workId), '1', 'PX', RETRY_COOLDOWN_MS, 'NX'))
      ) {
        return (await this.queue.getJob(id)) ? 'pending' : 'unavailable';
      }

      // A falha de uma hora atrás não segura quem pediu de novo.
      if (mark === 'failed') await this.cache.del(triedKey(workId));
      const job = await this.queue.getJob(id);
      if (job) {
        // Já sendo lida: é só esperar.
        if ((await job.getState()) === 'active') return 'pending';
        await job.remove();
      }
      await this.queue.add(
        JOB_IMSLP_SCORES,
        envelope<ImslpScoresJobPayload>({
          idempotencyKey: id,
          payload: { workId },
        }),
        {
          jobId: id,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
          lifo: true,
        },
      );
      return 'pending';
    } catch (error: unknown) {
      this.logger.warn(
        `IMSLP: não foi possível procurar de novo as partituras da obra ${workId}: ${errorMessage(error)}`,
      );
      return 'unavailable';
    }
  }

  /**
   * Só a situação, sem enfileirar — é o que a página pergunta enquanto mostra
   * "buscando partituras". Barata: uma contagem e duas leituras no Redis.
   */
  async status(workId: string): Promise<ImslpStatus> {
    try {
      const known = await this.knownStatus(workId);
      if (known) return known;

      const job = await this.queue.getJob(imslpScoresJobId(workId));
      return job ? 'pending' : 'unavailable';
    } catch {
      return 'unavailable';
    }
  }

  /**
   * Lê a página da obra no IMSLP e grava as partituras. Chamado pelo worker;
   * devolve quantas gravou. Falha de rede conta para o disjuntor e marca a obra
   * por uma hora; nada aqui é retentado pela fila (uma tentativa só).
   */
  async scrape(workId: string): Promise<number> {
    if (!isMongoId(workId)) return 0;

    const redis = await this.redis();
    const locked = await redis.set(
      lockKey(workId),
      '1',
      'PX',
      LOCK_TTL_MS,
      'NX',
    );
    if (!locked) return 0;

    try {
      if ((await this.storedCount(workId)) > 0) {
        await this.mark(workId, 'done', TRIED_TTL_MS);
        return 0;
      }

      if (await this.breakerOpen()) {
        await this.mark(workId, 'failed', FAILED_TTL_MS);
        return 0;
      }

      const permlink = await this.permlinkOf(workId);
      if (!permlink) {
        await this.mark(workId, 'done', TRIED_TTL_MS);
        return 0;
      }

      const parsed = await this.fetchScores(permlink);
      const totals = JSON.stringify(parsed.totals);

      if (parsed.scores.length > 0) {
        try {
          await this.prisma.workScore.createMany({
            data: parsed.scores.map((score) => ({
              workId,
              ...this.fields(score, totals),
            })),
          });
        } catch (error: unknown) {
          // Outra gravação chegou primeiro (índice único): o resultado é o mesmo.
          if (
            !(error instanceof Prisma.PrismaClientKnownRequestError) ||
            error.code !== 'P2002'
          ) {
            throw error;
          }
        }
      }

      await this.mark(workId, 'done', TRIED_TTL_MS);
      // A página da obra (e a contagem no compositor) mostra as novas.
      if (parsed.scores.length > 0) {
        await this.cache.invalidateMany([
          CacheNamespace.WORKS,
          CacheNamespace.COMPOSERS,
        ]);
      }
      this.logger.log(
        `IMSLP: ${parsed.scores.length} partitura(s) gravadas para a obra ${workId}`,
      );
      return parsed.scores.length;
    } catch (error: unknown) {
      await this.mark(workId, 'failed', FAILED_TTL_MS);
      this.logger.warn(
        `IMSLP: falha ao ler as partituras da obra ${workId}: ${errorMessage(error)}`,
      );
      return 0;
    } finally {
      await redis.del(lockKey(workId)).catch(() => undefined);
    }
  }

  /**
   * Relê a página e atualiza o que mudou — para quando o IMSLP ganha arquivo
   * novo numa obra que já tinha partitura guardada. Uso administrativo, na
   * hora (o admin espera o resultado).
   */
  async refresh(
    workId: string,
  ): Promise<{ created: number; updated: number; total: number }> {
    const permlink = await this.permlinkOf(workId);

    if (!permlink) {
      throw new NotFoundException('Obra sem página no IMSLP');
    }

    const parsed = await this.fetchScores(permlink);
    const totals = JSON.stringify(parsed.totals);
    let created = 0;
    let updated = 0;

    for (const score of parsed.scores) {
      const where = {
        workId_sourceId_source: {
          workId,
          sourceId: score.sourceId,
          source: ScoreSource.IMSLP,
        },
      };
      const exists = await this.prisma.workScore.findUnique({
        where,
        select: { id: true },
      });

      if (exists) {
        await this.prisma.workScore.update({
          where,
          data: this.fields(score, totals),
        });
        updated++;
      } else {
        await this.prisma.workScore.create({
          data: { workId, ...this.fields(score, totals) },
        });
        created++;
      }
    }

    await this.mark(workId, 'done', TRIED_TTL_MS);
    if (created || updated) {
      await this.cache.invalidateMany([
        CacheNamespace.WORKS,
        CacheNamespace.COMPOSERS,
      ]);
    }
    return { created, updated, total: parsed.scores.length };
  }

  // -------------------------------------------------------------------

  /** O que já se sabe sem enfileirar nada; `null` quando é preciso buscar. */
  private async knownStatus(workId: string): Promise<ImslpStatus | null> {
    if (!isMongoId(workId)) return 'none';
    if ((await this.storedCount(workId)) > 0) return 'stored';
    // Sem página válida no IMSLP não há o que buscar: nem fila, nem espera.
    if (!(await this.permlinkOf(workId))) return 'none';

    const mark = await this.cache.get<TriedMark | boolean>(triedKey(workId));
    // `true` é a marca gravada antes da fila existir: tentativa feita.
    if (mark === 'done' || mark === true) return 'none';
    if (mark === 'failed') return 'unavailable';
    return null;
  }

  private storedCount(workId: string): Promise<number> {
    return this.prisma.workScore.count({
      where: { workId, source: ScoreSource.IMSLP },
    });
  }

  private mark(workId: string, value: TriedMark, ttlMs: number) {
    return this.cache.set(triedKey(workId), value, ttlMs);
  }

  /** Lê e interpreta a página; o resultado alimenta o disjuntor. */
  private async fetchScores(permlink: string) {
    try {
      const { $ } = await this.fetcher.load(permlink, 'imslp');
      const parsed = parseImslpScores($);
      await this.breakerSuccess();
      return parsed;
    } catch (error: unknown) {
      await this.breakerFailure();
      throw error;
    }
  }

  private async breakerOpen(): Promise<boolean> {
    return (await (await this.redis()).get(BREAKER_OPEN)) !== null;
  }

  private async breakerSuccess(): Promise<void> {
    await (await this.redis()).del(BREAKER_FAILURES);
  }

  /**
   * Conta a falha numa janela de 5 minutos; na quinta seguida, abre o
   * disjuntor por 10 — ninguém pede ao IMSLP até lá, e as obras pedidas nesse
   * meio-tempo ficam "indisponível agora" em vez de entupirem a fila.
   */
  private async breakerFailure(): Promise<void> {
    const redis = await this.redis();
    const failures = await redis.incr(BREAKER_FAILURES);
    if (failures === 1)
      await redis.pexpire(BREAKER_FAILURES, BREAKER_WINDOW_MS);
    if (failures >= BREAKER_THRESHOLD) {
      await redis.set(BREAKER_OPEN, '1', 'PX', BREAKER_OPEN_MS, 'NX');
      await redis.del(BREAKER_FAILURES);
      this.logger.warn(
        `IMSLP: ${failures} falhas seguidas — pausa de ${BREAKER_OPEN_MS / 60_000} min`,
      );
    }
  }

  /** O cliente Redis da própria fila: atômico e sem conexão a mais. */
  private async redis(): Promise<RedisLike> {
    return (await this.queue.client) as unknown as RedisLike;
  }

  private async permlinkOf(workId: string): Promise<string | null> {
    const work = await this.prisma.work.findUnique({
      where: { id: workId },
      select: { imslpPermlink: true },
    });

    const permlink = work?.imslpPermlink?.trim();
    return permlink && IMSLP_WORK_PAGE.test(permlink) ? permlink : null;
  }

  private fields(score: ParsedImslpScore, totals: string) {
    return {
      sourceId: score.sourceId,
      source: ScoreSource.IMSLP,
      title: score.title,
      downloadUrl: score.downloadUrl,
      thumbnailUrl: score.thumbnailUrl,
      fileSize: score.fileSize,
      pageCount: score.pageCount,
      fileFormat: score.fileFormat,
      downloadCount: score.downloadCount,
      uploader: score.uploader,
      editor: score.editor,
      publisher: score.publisher,
      copyright: score.copyright,
      type: score.type,
      groupIndex: score.groupIndex,
      groupTitle: score.groupTitle,
      imslpTotalCounts: totals,
    };
  }
}
