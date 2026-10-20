import { Prisma, ScoreSource } from '@prisma/client';
import { fieldIs } from '../../common/database/optional-fields';
import { errorMessage } from '../../common/utils/error.util';
import { ExternalPageFetcher } from '../../scrapers/imslp/external-page.fetcher';
import { parseImslpScores } from '../../scrapers/imslp/imslp-scores.parser';
import { chunks, sleep, type CatalogJobWork } from './job-types';

/**
 * Relê a ficha da edição no IMSLP das partituras guardadas sem editor nem
 * editora (a raspagem antiga não lia a ficha, e o título saía sempre
 * "Partitura Completa"). Atualiza editor, editora, copyright, título e grupo
 * de cada arquivo já guardado; não troca o endereço nem cria arquivo.
 *
 * Vai das obras mais baixadas para as menos baixadas e pode ser interrompida e
 * retomada: a obra lida fica marcada (`Work.editionsCheckedAt`) e não é relida.
 * O IMSLP é de terceiros: uma requisição por vez, com pausa.
 *
 * Parâmetros: `limit` (obras nesta rodada; sem `--apply`, 20), `pause` (ms).
 */
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

  // Obras com arquivo sem edição, pela maior contagem de downloads.
  const rows = await prisma.workScore.groupBy({
    by: ['workId'],
    where: {
      source: ScoreSource.IMSLP,
      AND: [
        fieldIs<Prisma.WorkScoreWhereInput>('editor', false),
        fieldIs<Prisma.WorkScoreWhereInput>('publisher', false),
      ],
    },
    _max: { downloadCount: true },
  });
  const checked = new Set<string>();
  for (const part of chunks(
    rows.map((r) => r.workId),
    1000,
  )) {
    const found = await prisma.work.findMany({
      where: {
        id: { in: part },
        editionsCheckedAt: { not: null },
      },
      select: { id: true },
    });
    found.forEach((w) => checked.add(w.id));
  }
  const order = rows
    .filter((r) => !checked.has(r.workId))
    .sort(
      (a, b) =>
        Number(b._max.downloadCount ?? 0) - Number(a._max.downloadCount ?? 0),
    )
    .map((r) => r.workId)
    .slice(0, limit);
  logger.log(
    `${rows.length} obra(s) com partitura sem edição; ${checked.size} já lidas; ${order.length} nesta rodada`,
  );

  const fetcher = new ExternalPageFetcher();
  let read = 0;
  let filled = 0;
  let scoresFilled = 0;
  let none = 0;
  let failed = 0;
  let streak = 0;
  const samples: string[] = [];

  for (const workId of order) {
    if (shouldStop()) {
      logger.warn('Parada pedida: encerrando.');
      break;
    }
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
        let any = false;
        for (const s of parsed.scores) {
          if (!s.editor && !s.publisher && !s.copyright) continue;
          any = true;
          scoresFilled++;
          if (apply) {
            await prisma.workScore.updateMany({
              where: {
                workId,
                sourceId: s.sourceId,
                source: ScoreSource.IMSLP,
              },
              data: {
                title: s.title,
                groupTitle: s.groupTitle,
                groupIndex: s.groupIndex,
                ...(s.editor ? { editor: s.editor } : {}),
                ...(s.publisher ? { publisher: s.publisher } : {}),
                ...(s.copyright ? { copyright: s.copyright } : {}),
                ...(s.uploader ? { uploader: s.uploader } : {}),
              },
            });
          }
        }
        if (any) filled++;
        if (samples.length < 6 && parsed.scores[0])
          samples.push(
            `${work?.title}: ${parsed.scores[0].title} | ${parsed.scores[0].editor ?? '—'} | ${(parsed.scores[0].publisher ?? '—').slice(0, 60)}`,
          );
      }
      read++;
      if (apply)
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
    `Lidas ${read}; ${filled} obra(s) e ${scoresFilled} arquivo(s) ganham edição; ${none} sem página; ${failed} falha(s)${apply ? '' : ' (simulação)'}`,
  );
  return {
    summary: {
      lidas: read,
      obrasComEdicao: filled,
      arquivosAtualizados: scoresFilled,
      semPagina: none,
      falhas: failed,
      restantes: Math.max(rows.length - checked.size - read, 0),
    },
    sample: samples,
  };
};
