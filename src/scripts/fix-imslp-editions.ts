import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { Prisma, ScoreSource } from '@prisma/client';
import { fieldIs } from '../common/database/optional-fields';
import { ExternalPageFetcher } from '../scrapers/imslp/external-page.fetcher';
import { parseImslpScores } from '../scrapers/imslp/imslp-scores.parser';
import { errorMessage } from '../common/utils/error.util';
import { runCatalogScript } from './catalog-script';

/**
 * Relê a ficha da edição no IMSLP das partituras guardadas sem editor nem
 * editora (a raspagem antiga não lia a ficha, e o título saía sempre
 * "Partitura Completa"). Atualiza editor, editora, copyright, título e grupo
 * de cada arquivo já guardado; não troca o endereço nem cria arquivo.
 *
 * Vai das obras mais baixadas para as menos baixadas e pode ser interrompido
 * a qualquer hora: as obras lidas ficam no arquivo de progresso e não são
 * relidas. O IMSLP é de terceiros: uma requisição por vez, com pausa.
 *
 *   node dist/scripts/fix-imslp-editions.js --limit=20          # simula
 *   node dist/scripts/fix-imslp-editions.js --apply             # grava, tudo
 *   ... --apply --limit=500 --pause=1500 --progress=/caminho.txt
 */
const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ??
  fallback;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

void runCatalogScript('FixImslpEditions', async ({ prisma, apply, logger }) => {
  const apply_ = apply;
  const limit = Number(arg('limit', apply_ ? '0' : '20')) || undefined;
  const pause = Number(arg('pause', '1200'));
  const progressFile = arg('progress', '.imslp-editions-progress.txt');
  const done = new Set(
    existsSync(progressFile)
      ? readFileSync(progressFile, 'utf8').split('\n').filter(Boolean)
      : [],
  );

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
  const order = rows
    .filter((r) => !done.has(r.workId))
    .sort(
      (a, b) =>
        Number(b._max.downloadCount ?? 0) - Number(a._max.downloadCount ?? 0),
    )
    .map((r) => r.workId)
    .slice(0, limit);
  logger.log(
    `${rows.length} obra(s) com partitura sem edição; ${done.size} já lidas; ${order.length} nesta rodada`,
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
          if (apply_) {
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
      if (apply_) appendFileSync(progressFile, `${workId}\n`);
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
    if (read % 100 === 0 && read > 0)
      logger.log(
        `${read}/${order.length} obras; ${filled} com edição; ${failed} falhas`,
      );
    await sleep(pause);
  }

  for (const s of samples) logger.log(`e.g. ${s}`);
  logger.log(
    `Lidas ${read}; ${filled} obra(s) e ${scoresFilled} arquivo(s) ganham edição; ${none} sem página; ${failed} falha(s)${apply_ ? '' : ' (simulação)'}`,
  );
});
