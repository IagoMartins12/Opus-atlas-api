import { Prisma, ScoreSource, type IMSLPScoreType } from '@prisma/client';
import { errorMessage } from '../../common/utils/error.util';
import { ExternalPageFetcher } from '../../scrapers/imslp/external-page.fetcher';
import {
  parseImslpScores,
  type ParsedImslpScore,
} from '../../scrapers/imslp/imslp-scores.parser';
import { chunks, sleep, type CatalogJobWork } from './job-types';

/**
 * Confere as partituras do IMSLP já guardadas contra a página de cada obra, e
 * corrige o que a leitura deixou errado.
 *
 * **Por que existe (02/11).** A raspagem falhou duas vezes sem ninguém ver:
 * um arquivo repetido na página fazia a gravação inteira ser recusada (os
 * Cadernos de Anna Magdalena Bach ficaram sem partitura), e a ficha da edição
 * era lida com as caixas de aviso dentro — um parágrafo jurídico no lugar da
 * editora, em 2 mil arquivos. Corrigido o leitor, faltava corrigir o que ele
 * já tinha gravado, e ter uma rede para a próxima falha que não se anuncia.
 *
 * Relê a obra quando:
 * - **faltam arquivos**: a página dizia ter mais do que há guardado
 *   (`imslpTotalCounts`, gravado junto com cada partitura);
 * - **a ficha está suja**: editora, editor ou copyright com aviso do IMSLP,
 *   longa demais, ou com duas linhas coladas ("(pp.45-138)Kassel").
 *
 * Grava o arquivo que falta e reescreve a ficha, o título e o grupo dos que
 * já estavam; não apaga nada nem troca o endereço do PDF. A obra conferida
 * passa a guardar como total o que foi lido — é o que impede de relê-la a
 * cada rodada quando a diferença era só arquivo repetido na página.
 *
 * Também é manutenção agendável (`catalog.recheck-imslp-scores`), com teto
 * por rodada. O IMSLP é de terceiros: uma requisição por vez, com pausa.
 *
 * Parâmetros: `limit` (obras nesta rodada; sem `--apply`, 20), `pause` (ms)
 * e `work` (o id de uma obra só, mesmo que pareça em ordem).
 */

/** Texto do IMSLP que nunca é ficha de edição: as caixas de aviso. */
const BOILERPLATE =
  'URTEXT EDITION|This is an urtext|In the USA this work|Please obey|IMSLP does not assume|More information can be found';

/** Ficha mais longa que isto é aviso colado, não editora. */
const MAX_FIELD = 250;

/**
 * Quando o leitor da ficha passou a tirar as caixas de aviso. Obra lida depois
 * disso (`Work.editionsCheckedAt`) não volta pela ficha suja: um "McGraw" de
 * verdade parece duas linhas coladas, e seria relido a cada rodada.
 */
export const EDITION_READER_FIXED_AT = new Date('2026-11-02T00:00:00Z');

/** Duas linhas da ficha coladas: "(pp.45-138)Kassel", "MeisternPublikation". */
const GLUED = '[a-zà-ÿß)][A-ZÀ-Ý][a-zà-ÿ]';

type Candidate = {
  workId: string;
  stored: number;
  onPage: number;
  dirty: boolean;
  downloads: number;
};

const dirtyField = (name: string) => ({
  $or: [
    {
      $regexMatch: { input: { $ifNull: [`$${name}`, ''] }, regex: BOILERPLATE },
    },
    { $regexMatch: { input: { $ifNull: [`$${name}`, ''] }, regex: GLUED } },
    { $gt: [{ $strLenCP: { $ifNull: [`$${name}`, ''] } }, MAX_FIELD] },
  ],
});

/** O total que a página dizia ter, somando as abas. */
function pageTotal(raw: string | null): number {
  if (!raw) return 0;
  try {
    const totals = JSON.parse(raw) as Record<string, number>;
    return Object.values(totals).reduce((a, b) => a + (Number(b) || 0), 0);
  } catch {
    return 0;
  }
}

/** Os arquivos lidos por aba, no formato de `imslpTotalCounts`. */
function readTotals(scores: ParsedImslpScore[]): string {
  const totals: Partial<Record<Lowercase<IMSLPScoreType>, number>> = {};
  for (const s of scores) {
    const key = s.type.toLowerCase() as Lowercase<IMSLPScoreType>;
    totals[key] = (totals[key] ?? 0) + 1;
  }
  return JSON.stringify(totals);
}

export const work: CatalogJobWork = async ({
  prisma,
  apply,
  logger,
  args,
  progress,
  shouldStop,
}) => {
  const limit = Number(args.limit ?? (apply ? 0 : 20)) || undefined;
  const pause = Number(args.pause ?? 1200);
  const only = typeof args.work === 'string' ? args.work.trim() : '';

  const rows = (await prisma.workScore.aggregateRaw({
    pipeline: [
      {
        $match: {
          source: ScoreSource.IMSLP,
          ...(only ? { workId: { $oid: only } } : {}),
        },
      },
      {
        $group: {
          _id: '$workId',
          stored: { $sum: 1 },
          totals: { $first: '$imslpTotalCounts' },
          downloads: { $max: { $ifNull: ['$downloadCount', 0] } },
          dirty: {
            $max: {
              $or: [
                dirtyField('publisher'),
                dirtyField('editor'),
                dirtyField('copyright'),
              ],
            },
          },
        },
      },
    ],
    options: { allowDiskUse: true },
  })) as unknown as Array<{
    _id: { $oid: string } | string;
    stored: number;
    totals: string | null;
    downloads: number | { $numberLong: string };
    dirty: boolean;
  }>;

  const candidates: Candidate[] = rows
    .map((r) => ({
      workId: typeof r._id === 'string' ? r._id : r._id.$oid,
      stored: r.stored,
      onPage: pageTotal(r.totals),
      dirty: r.dirty,
      downloads:
        typeof r.downloads === 'object'
          ? Number(r.downloads.$numberLong)
          : Number(r.downloads),
    }))
    .filter((c) => only || c.dirty || c.stored < c.onPage);

  const recent = new Set<string>();
  for (const part of chunks(
    candidates.filter((c) => c.dirty).map((c) => c.workId),
  )) {
    const found = await prisma.work.findMany({
      where: {
        id: { in: part },
        editionsCheckedAt: { gte: EDITION_READER_FIXED_AT },
      },
      select: { id: true },
    });
    found.forEach((w) => recent.add(w.id));
  }
  for (const c of candidates) if (recent.has(c.workId)) c.dirty = false;
  candidates.splice(
    0,
    candidates.length,
    ...candidates
      .filter((c) => only || c.dirty || c.stored < c.onPage)
      .sort((a, b) => b.downloads - a.downloads),
  );

  const missing = candidates.filter((c) => c.stored < c.onPage).length;
  const dirty = candidates.filter((c) => c.dirty).length;
  const order = candidates.slice(0, limit);
  logger.log(
    `${rows.length} obra(s) com partitura do IMSLP; ${missing} com arquivo faltando, ${dirty} com ficha suja; ${order.length} nesta rodada`,
  );

  const fetcher = new ExternalPageFetcher();
  let read = 0;
  let created = 0;
  let updated = 0;
  let none = 0;
  let failed = 0;
  let streak = 0;
  const samples: string[] = [];

  for (const candidate of order) {
    if (shouldStop()) {
      logger.warn('Parada pedida: encerrando.');
      break;
    }
    const { workId } = candidate;
    const work = await prisma.work.findUnique({
      where: { id: workId },
      select: { title: true, imslpPermlink: true },
    });
    const permlink = work?.imslpPermlink?.trim();
    try {
      if (!permlink) {
        none++;
      } else {
        const { $ } = await fetcher.load(permlink, 'imslp');
        const parsed = parseImslpScores($);
        streak = 0;
        const stored = new Set(
          (
            await prisma.workScore.findMany({
              where: { workId, source: ScoreSource.IMSLP },
              select: { sourceId: true },
            })
          ).map((s) => s.sourceId),
        );
        const totals = readTotals(parsed.scores);
        let added = 0;

        for (const s of parsed.scores) {
          const fields = {
            title: s.title,
            type: s.type,
            groupTitle: s.groupTitle,
            groupIndex: s.groupIndex,
            editor: s.editor,
            publisher: s.publisher,
            copyright: s.copyright,
            imslpTotalCounts: totals,
            ...(s.uploader ? { uploader: s.uploader } : {}),
          };
          if (stored.has(s.sourceId)) {
            updated++;
            if (apply)
              await prisma.workScore.updateMany({
                where: {
                  workId,
                  sourceId: s.sourceId,
                  source: ScoreSource.IMSLP,
                },
                data: fields,
              });
            continue;
          }
          added++;
          created++;
          if (!apply) continue;
          await prisma.workScore
            .create({
              data: {
                ...fields,
                workId,
                sourceId: s.sourceId,
                source: ScoreSource.IMSLP,
                downloadUrl: s.downloadUrl,
                thumbnailUrl: s.thumbnailUrl,
                fileSize: s.fileSize,
                pageCount: s.pageCount,
                fileFormat: s.fileFormat,
                downloadCount: s.downloadCount,
              },
            })
            .catch((error: unknown) => {
              // Gravado por outra leitura no meio-tempo: o resultado é o mesmo.
              if (
                !(error instanceof Prisma.PrismaClientKnownRequestError) ||
                error.code !== 'P2002'
              )
                throw error;
            });
        }

        if (samples.length < 6 && (added > 0 || candidate.dirty)) {
          const first = parsed.scores.find((s) => s.publisher);
          samples.push(
            `${work?.title}: ${candidate.stored} → ${candidate.stored + added} arquivo(s)` +
              (first ? ` | ${first.publisher?.slice(0, 70)}` : ''),
          );
        }
      }
      read++;
      if (apply && permlink)
        await prisma.work.update({
          where: { id: workId },
          data: { editionsCheckedAt: new Date() },
        });
    } catch (error: unknown) {
      failed++;
      streak++;
      logger.warn(`${work?.title ?? workId}: ${errorMessage(error)}`);
      if (streak >= 8) {
        logger.error('8 falhas seguidas: parando. Rode de novo mais tarde.');
        break;
      }
      await sleep(15_000);
    }
    progress(read + failed, order.length, `${read} lidas, ${failed} falhas`);
    await sleep(pause);
  }

  for (const s of samples) logger.log(`e.g. ${s}`);
  logger.log(
    `Lidas ${read}; ${created} arquivo(s) novo(s), ${updated} conferido(s); ${none} sem página; ${failed} falha(s)${apply ? '' : ' (simulação)'}`,
  );
  return {
    summary: {
      lidas: read,
      arquivosNovos: created,
      arquivosConferidos: updated,
      comArquivoFaltando: missing,
      comFichaSuja: dirty,
      semPagina: none,
      falhas: failed,
      restantes: Math.max(candidates.length - read, 0),
    },
    sample: samples,
  };
};
