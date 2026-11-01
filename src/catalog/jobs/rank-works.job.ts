import { prominenceOf } from '../quality/work-prominence';
import { FAMOUS_COMPOSERS } from '../works/famous-composers';
import { chunks, type CatalogJobWork } from './job-types';

/** Obras lidas por vez: o acervo inteiro não cabe numa consulta só. */
const PAGE = 5000;

/**
 * Recalcula `Work.prominence`, a nota de fama que ordena "em destaque" (ver
 * `quality/work-prominence.ts`). Lê os sinais de uma vez (downloads somados
 * por obra, listas de estudo, favoritos), passa pelo acervo em páginas e só
 * grava a obra cuja nota mudou.
 *
 * Os downloads só existem para as obras cujas partituras já foram lidas do
 * IMSLP; a cada leitura nova, a nota fica para trás até a próxima rodada —
 * por isso a rotina também é uma manutenção agendável (`catalog.rank-works`).
 * A nota não muda o `updatedAt`: não é mudança da página.
 *
 *   node dist/scripts/rank-works.js           # simula
 *   node dist/scripts/rank-works.js --apply   # grava
 */
export const work: CatalogJobWork = async ({
  prisma,
  apply,
  logger,
  progress,
  shouldStop,
}) => {
  const [downloads, wants, learned, favorites, famous, total] =
    await Promise.all([
      prisma.workScore.groupBy({
        by: ['workId'],
        where: { isActive: true },
        _sum: { downloadCount: true },
      }),
      prisma.wantToLearn.groupBy({ by: ['workId'], _count: { _all: true } }),
      prisma.learned.groupBy({ by: ['workId'], _count: { _all: true } }),
      prisma.favoriteWork.groupBy({ by: ['workId'], _count: { _all: true } }),
      prisma.composer.findMany({
        where: {
          OR: [
            { fullName: { in: FAMOUS_COMPOSERS } },
            { name: { in: FAMOUS_COMPOSERS } },
          ],
        },
        select: { id: true },
      }),
      prisma.work.count(),
    ]);

  const downloadsOf = new Map(
    downloads.map((d) => [d.workId, d._sum.downloadCount ?? 0]),
  );
  const people = new Map<string, number>();
  for (const list of [wants, learned, favorites])
    for (const row of list)
      people.set(row.workId, (people.get(row.workId) ?? 0) + row._count._all);
  const famousIds = new Set(famous.map((c) => c.id));

  /** Nota nova → obras que passam a tê-la. */
  const changes = new Map<number, string[]>();
  const ranked: Array<{ id: string; title: string; score: number }> = [];
  let changed = 0;
  let cursor: string | undefined;
  let done = 0;

  for (;;) {
    if (shouldStop()) break;
    const page = await prisma.work.findMany({
      select: {
        id: true,
        title: true,
        composerId: true,
        popularName: true,
        famousParts: true,
        annotationsCount: true,
        spotifyTrackId: true,
        youtubeVideoId: true,
        prominence: true,
      },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
    });
    if (!page.length) break;
    cursor = page[page.length - 1].id;

    for (const w of page) {
      const score = prominenceOf({
        downloads: downloadsOf.get(w.id) ?? 0,
        hasPopularName: !!w.popularName,
        hasFamousParts: w.famousParts.length > 0,
        people: (people.get(w.id) ?? 0) + w.annotationsCount,
        hasRecording: !!(w.spotifyTrackId || w.youtubeVideoId),
        byFamousComposer: famousIds.has(w.composerId),
      });
      if (score >= 300) ranked.push({ id: w.id, title: w.title, score });
      // No field yet (`null`) is written even when the score is 0.
      if (score === w.prominence) continue;
      changed++;
      const ids = changes.get(score) ?? [];
      ids.push(w.id);
      changes.set(score, ids);
    }
    done += page.length;
    progress(done, total);
  }

  ranked.sort((a, b) => b.score - a.score);
  const sample = ranked.slice(0, 25).map((r) => `${r.score} · ${r.title}`);
  logger.log(`As mais conhecidas:\n  ${sample.join('\n  ')}`);
  logger.log(
    `${done} obra(s) examinadas; ${downloadsOf.size} com downloads do IMSLP; ${changed} mudam de nota`,
  );
  const outcome = {
    summary: {
      examinadas: done,
      comDownloads: downloadsOf.size,
      mudamDeNota: changed,
      acimaDe300: ranked.length,
    },
    sample,
  };
  if (!apply) return outcome;

  // A command, not `updateMany`: Prisma would also bump `updatedAt`, and the
  // IndexNow run would announce thousands of pages whose content is the same.
  let written = 0;
  for (const [score, ids] of changes)
    for (const part of chunks(ids)) {
      if (shouldStop()) return outcome;
      await prisma.$runCommandRaw({
        update: 'Work',
        updates: [
          {
            q: { _id: { $in: part.map((id) => ({ $oid: id })) } },
            u: { $set: { prominence: score } },
            multi: true,
          },
        ],
      });
      written += part.length;
      progress(written, changed, 'gravando');
    }
  logger.log(`Gravado: ${written} obra(s)`);
  return outcome;
};
