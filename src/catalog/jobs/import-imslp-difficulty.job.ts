import { ExternalPageFetcher } from '../../scrapers/imslp/external-page.fetcher';
import {
  CURATED_SYSTEM,
  DIFFICULTY_LISTS,
  IMSLP_SYSTEM,
  parseDifficultyPage,
  summarize,
  type DifficultyEntry,
} from '../quality/imslp-difficulty';
import { chunks, sleep, type CatalogJobWork } from './job-types';

const LIST_URL = 'https://imslp.org/wiki/Special:DiffPage/DiffMain/';
const API_URL = 'https://imslp.org/api.php';
/** Títulos por consulta à API (o endereço fica abaixo de 8 KB). */
const TITLES_PER_QUERY = 30;
const DEFAULT_PAUSE_MS = 1500;

interface ApiQuery {
  query?: {
    normalized?: Array<{ from: string; to: string }>;
    redirects?: Array<{ from: string; to: string }>;
    pages?: Record<string, { pageid?: number; title: string }>;
  };
}

/**
 * A dificuldade do acervo passa a vir só de quem curou: o Difficulty Project
 * do IMSLP (ver `quality/imslp-difficulty.ts`) ou quem edita no painel.
 *
 * 1. Lê as 14 listas (uma por instrumento), com pausa entre elas.
 * 2. Resolve o título de cada página no número dela (`pageid`) pela API do
 *    IMSLP: é o `imslpId` das obras, e não muda quando o IMSLP renomeia a
 *    página ("100 Übungsstücke" era "100 Progressive Studies" no acervo).
 *    A entrada que só traz o arquivo casa pelas partituras já guardadas.
 * 3. Tira a dificuldade de toda obra que não foi curada no painel — o palpite
 *    da raspagem sai inteiro —, sem mexer no `updatedAt` dessas.
 * 4. Troca as avaliações guardadas (`WorkDifficulty`) e grava o nível de cada
 *    obra avaliada.
 *
 *   node dist/scripts/import-imslp-difficulty.js           # simula
 *   node dist/scripts/import-imslp-difficulty.js --apply   # grava
 */
export const work: CatalogJobWork = async ({
  prisma,
  apply,
  logger,
  args,
  progress,
  shouldStop,
}) => {
  const pause = Number(args.pause) || DEFAULT_PAUSE_MS;
  const fetcher = new ExternalPageFetcher();
  const warnings: string[] = [];

  // 1. As listas.
  const entries: DifficultyEntry[] = [];
  for (const [i, list] of DIFFICULTY_LISTS.entries()) {
    if (shouldStop()) return { warnings: ['Parado antes de ler as listas.'] };
    const { $ } = await fetcher.load(`${LIST_URL}${list.page}`, 'imslp');
    const rows = parseDifficultyPage($.html(), list.instrument);
    if (!rows.length)
      warnings.push(`A lista de ${list.instrument} veio vazia.`);
    entries.push(...rows);
    progress(i + 1, DIFFICULTY_LISTS.length, `lista de ${list.instrument}`);
    await sleep(pause);
  }
  // Uma lista vazia é página que mudou de formato, não obra sem nível: parar
  // aqui evita apagar o nível de todo um instrumento.
  if (warnings.length)
    return {
      summary: { entradas: entries.length },
      warnings: [...warnings, 'Nada foi gravado.'],
    };

  // 2. Título → número da página.
  const titles = [
    ...new Set(entries.map((e) => e.page).filter((t): t is string => !!t)),
  ];
  const pageIdOf = new Map<string, string>();
  const parts = chunks(titles, TITLES_PER_QUERY);
  for (const [i, part] of parts.entries()) {
    if (shouldStop()) return { warnings: ['Parado ao resolver as páginas.'] };
    const query = new URLSearchParams({
      action: 'query',
      format: 'json',
      redirects: '1',
      titles: part.join('|'),
    });
    const { data } = await fetcher.loadJson<ApiQuery>(
      `${API_URL}?${query}`,
      'imslp',
    );
    const step = new Map<string, string>();
    for (const n of [
      ...(data.query?.normalized ?? []),
      ...(data.query?.redirects ?? []),
    ])
      step.set(n.from, n.to);
    const byTitle = new Map(
      Object.values(data.query?.pages ?? {})
        .filter((p) => p.pageid)
        .map((p) => [p.title, String(p.pageid)]),
    );
    for (const title of part) {
      let resolved = title;
      for (let hops = 0; hops < 3 && step.has(resolved); hops++)
        resolved = step.get(resolved)!;
      const id = byTitle.get(resolved);
      if (id) pageIdOf.set(title, id);
    }
    progress(i + 1, parts.length, 'páginas no IMSLP');
    await sleep(pause);
  }

  // 3. Página ou arquivo → obra do acervo.
  const fileIds = [...new Set(entries.flatMap((e) => e.fileIds))];
  const [byPage, byFile] = await Promise.all([
    prisma.work.findMany({
      where: { imslpId: { in: [...new Set(pageIdOf.values())] } },
      select: { id: true, imslpId: true },
    }),
    prisma.workScore.findMany({
      where: { sourceId: { in: fileIds }, source: 'IMSLP' },
      select: { sourceId: true, workId: true },
    }),
  ]);
  const worksOfPage = new Map<string, string[]>();
  for (const w of byPage)
    worksOfPage.set(w.imslpId, [...(worksOfPage.get(w.imslpId) ?? []), w.id]);
  const workOfFile = new Map(byFile.map((s) => [s.sourceId, s.workId]));

  const entriesOf = new Map<string, DifficultyEntry[]>();
  const rows: Array<DifficultyEntry & { workId: string }> = [];
  const missing = new Set<string>();
  for (const e of entries) {
    const pageId = e.page ? pageIdOf.get(e.page) : undefined;
    let workIds = pageId ? (worksOfPage.get(pageId) ?? []) : [];
    if (!workIds.length) {
      const viaFile = e.fileIds.map((f) => workOfFile.get(f)).find(Boolean);
      workIds = viaFile ? [viaFile] : [];
    }
    if (!workIds.length) {
      missing.add(e.page ?? `arquivo #${e.fileIds[0]}`);
      continue;
    }
    for (const workId of workIds) {
      rows.push({ ...e, workId });
      entriesOf.set(workId, [...(entriesOf.get(workId) ?? []), e]);
    }
  }

  const nameOf = new Map(
    (
      await prisma.instrument.findMany({ select: { id: true, name: true } })
    ).map((i) => [i.id, i.name]),
  );
  const rated = await prisma.work.findMany({
    where: { id: { in: [...entriesOf.keys()] } },
    select: {
      id: true,
      title: true,
      difficultySystem: true,
      prominence: true,
      instrumentId: true,
      instrumentIds: true,
      composer: { select: { name: true } },
    },
  });
  const curated = rated.filter((w) => w.difficultySystem === CURATED_SYSTEM);
  // Obra avaliada só na lista de outro instrumento não ganha nível: a avaliação
  // fica guardada com o instrumento dela.
  const toWrite = rated
    .filter((w) => w.difficultySystem !== CURATED_SYSTEM)
    .flatMap((w) => {
      const summary = summarize(
        entriesOf.get(w.id)!,
        [w.instrumentId, ...w.instrumentIds].map(
          (id) => nameOf.get(id) ?? null,
        ),
      );
      return summary ? [{ work: w, summary }] : [];
    });

  // O que sai: toda dificuldade que não foi curada no painel.
  const guessed = {
    difficultySystem: { $ne: CURATED_SYSTEM },
    $or: [
      { difficultyLevel: { $type: 'string' } },
      { imslpDifficultyLevel: { $type: 'string' } },
    ],
  };
  // `$ne` também casa a obra que nunca teve o campo (o `NOT` do Prisma a
  // pularia): a contagem usa o mesmo filtro do comando.
  const counted = (await prisma.$runCommandRaw({
    count: 'Work',
    query: guessed,
  })) as { n?: number };
  const clearedCount = counted.n ?? 0;

  const tiers = { BEGINNER: 0, INTERMEDIATE: 0, ADVANCED: 0 };
  for (const { summary } of toWrite) tiers[summary.tier]++;
  const sample = toWrite
    .slice()
    .sort((a, b) => (b.work.prominence ?? 0) - (a.work.prominence ?? 0))
    .slice(0, 30)
    .map(
      ({ work: w, summary: s }) =>
        `${s.tier} (${s.rating}) · ${w.composer.name}: ${w.title}`,
    );
  logger.log(`As mais conhecidas avaliadas:\n  ${sample.join('\n  ')}`);
  if (missing.size)
    warnings.push(
      `${missing.size} obra(s) da lista não estão no acervo, por exemplo: ${[...missing].slice(0, 12).join('; ')}`,
    );
  if (curated.length)
    warnings.push(
      `${curated.length} obra(s) avaliadas mantêm o nível curado no painel.`,
    );
  const summary = {
    entradas: entries.length,
    obrasAvaliadas: toWrite.length,
    soEmOutroInstrumento: rated.length - curated.length - toWrite.length,
    iniciante: tiers.BEGINNER,
    intermediario: tiers.INTERMEDIATE,
    avancado: tiers.ADVANCED,
    palpitesRemovidos: clearedCount,
    foraDoAcervo: missing.size,
  };
  logger.log(JSON.stringify(summary));
  if (!apply) return { summary, sample, warnings };

  // 4. Gravar. A limpeza vai por comando: é a retirada de um palpite em
  // centenas de milhares de obras, e o `updatedAt` faria o IndexNow avisar
  // todas. As avaliadas, que mudam de verdade, vão pelo Prisma.
  await prisma.$runCommandRaw({
    update: 'Work',
    updates: [
      {
        q: guessed,
        u: {
          $set: {
            difficultyLevel: null,
            difficultySystem: null,
            difficultyRating: null,
            difficultySourceId: null,
            imslpDifficultyLevel: null,
            imslpDifficultySystem: null,
            imslpDifficultyRating: null,
            imslpSourceId: null,
          },
        },
        multi: true,
      },
    ],
  });
  await prisma.workDifficulty.deleteMany({});
  for (const part of chunks(rows))
    await prisma.workDifficulty.createMany({
      data: part.map((r) => ({
        workId: r.workId,
        entryId: r.entryId,
        instrument: r.instrument,
        level: r.level,
        excerpt: r.excerpt,
        pages: r.pages,
        fileId: r.fileIds[0] ?? null,
        reference: r.reference,
      })),
    });
  for (const [i, { work: w, summary: s }] of toWrite.entries()) {
    if (shouldStop()) break;
    await prisma.work.update({
      where: { id: w.id },
      data: {
        difficultyLevel: s.tier,
        difficultySystem: IMSLP_SYSTEM,
        difficultyRating: s.rating,
        difficultySourceId: String(s.entryId),
      },
    });
    if (i % 100 === 0) progress(i, toWrite.length, 'gravando');
  }
  logger.log(
    `Gravado: ${toWrite.length} obra(s), ${rows.length} avaliação(ões)`,
  );
  return { summary, sample, warnings };
};
