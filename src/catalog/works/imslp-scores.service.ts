import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, ScoreSource } from '@prisma/client';
import { isMongoId } from 'class-validator';
import { AppCacheService } from '../../common/cache/cache.service';
import { errorMessage } from '../../common/utils/error.util';
import { PrismaService } from '../../prisma/prisma.service';
import { ExternalPageFetcher } from '../../scrapers/imslp/external-page.fetcher';
import {
  ParsedImslpScore,
  parseImslpScores,
} from '../../scrapers/imslp/imslp-scores.parser';

/**
 * Obra já tentada não é raspada de novo por um dia — nem a que não tem arquivo
 * nenhum no IMSLP, que de outro modo seria buscada a cada visita.
 */
const TRIED_TTL_MS = 24 * 60 * 60 * 1000;

/** Falha (IMSLP fora, página mudou) tenta de novo mais cedo. */
const FAILED_TTL_MS = 60 * 60 * 1000;

/** Raspagens simultâneas por processo. A rota é pública; o IMSLP é de terceiros. */
const MAX_CONCURRENT = 3;

// Fora dos namespaces de cache de propósito: uma escrita no catálogo limpa
// `works:*`, e a marca de tentativa não deve sumir junto.
const triedKey = (workId: string) => `imslp-scores:tried:${workId}`;

/**
 * Partituras do IMSLP sob demanda — o substituto do `imslp-scores` do legado.
 *
 * **Por que é preciso.** Das 207 mil obras, só 23 mil (11%) têm partitura
 * guardada. O legado raspava o IMSLP na hora, na página da obra; sem isto, a
 * API mostraria a página de 89% das obras sem partitura nenhuma.
 *
 * **Como.** Na primeira visita a uma obra sem partitura do IMSLP, a página da
 * obra é lida uma vez, todos os arquivos são gravados, e a obra é marcada por
 * um dia — visitas seguintes leem do banco. Duas visitas simultâneas à mesma
 * obra esperam a mesma raspagem; e há um teto de raspagens em paralelo, porque
 * a rota é pública e cada chamada vira uma requisição a um site de terceiros.
 */
@Injectable()
export class ImslpScoresService {
  private readonly logger = new Logger(ImslpScoresService.name);
  private readonly inFlight = new Map<string, Promise<number>>();
  private running = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fetcher: ExternalPageFetcher,
    private readonly cache: AppCacheService,
  ) {}

  /**
   * Garante as partituras do IMSLP de uma obra; devolve quantas foram gravadas
   * agora. Nunca lança: falha do IMSLP não pode derrubar a página da obra.
   */
  async ensure(workId: string): Promise<number> {
    if (!isMongoId(workId)) return 0;

    // Registrado antes de qualquer `await`: a segunda visita simultânea
    // encontra a tarefa da primeira em vez de passar pelas mesmas conferências.
    const pending = this.inFlight.get(workId);
    if (pending) return pending;

    const job = this.ensureNow(workId).finally(() => {
      this.inFlight.delete(workId);
    });
    this.inFlight.set(workId, job);
    return job;
  }

  private async ensureNow(workId: string): Promise<number> {
    const stored = await this.prisma.workScore.count({
      where: { workId, source: ScoreSource.IMSLP },
    });
    if (stored > 0) return 0;

    if (await this.cache.get<boolean>(triedKey(workId))) return 0;

    // Sem vaga agora: a próxima visita tenta. Não marca, para não perder a obra.
    if (this.running >= MAX_CONCURRENT) return 0;

    return this.scrapeAndStore(workId);
  }

  /**
   * Relê a página e atualiza o que mudou — para quando o IMSLP ganha arquivo
   * novo numa obra que já tinha partitura guardada. Uso administrativo.
   */
  async refresh(
    workId: string,
  ): Promise<{ created: number; updated: number; total: number }> {
    const permlink = await this.permlinkOf(workId);

    if (!permlink) {
      throw new NotFoundException('Obra sem página no IMSLP');
    }

    const { $ } = await this.fetcher.load(permlink, 'imslp');
    const parsed = parseImslpScores($);
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

    await this.cache.set(triedKey(workId), true, TRIED_TTL_MS);
    return { created, updated, total: parsed.scores.length };
  }

  // -------------------------------------------------------------------

  private async scrapeAndStore(workId: string): Promise<number> {
    this.running++;

    try {
      const permlink = await this.permlinkOf(workId);

      if (!permlink) {
        await this.cache.set(triedKey(workId), true, TRIED_TTL_MS);
        return 0;
      }

      const { $ } = await this.fetcher.load(permlink, 'imslp');
      const parsed = parseImslpScores($);
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
          // Outra instância gravou primeiro (índice único): o resultado é o mesmo.
          if (
            !(error instanceof Prisma.PrismaClientKnownRequestError) ||
            error.code !== 'P2002'
          ) {
            throw error;
          }
        }
      }

      await this.cache.set(triedKey(workId), true, TRIED_TTL_MS);
      this.logger.log(
        `IMSLP: ${parsed.scores.length} partitura(s) gravadas para a obra ${workId}`,
      );
      return parsed.scores.length;
    } catch (error: unknown) {
      await this.cache.set(triedKey(workId), true, FAILED_TTL_MS);
      this.logger.warn(
        `IMSLP: falha ao ler as partituras da obra ${workId}: ${errorMessage(error)}`,
      );
      return 0;
    } finally {
      this.running--;
    }
  }

  private async permlinkOf(workId: string): Promise<string | null> {
    const work = await this.prisma.work.findUnique({
      where: { id: workId },
      select: { imslpPermlink: true },
    });

    const permlink = work?.imslpPermlink?.trim();
    return permlink && /^https?:\/\/(www\.)?imslp\.org\//.test(permlink)
      ? permlink
      : null;
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
