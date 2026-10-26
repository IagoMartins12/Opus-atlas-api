import { readFileSync } from 'fs';
import {
  CatalogWork,
  PopularNameEntry,
  TOO_MANY,
  changesFor,
  matchPopularNames,
} from '../catalog/works/popular-names/popular-names';
import { runCatalogScript } from './catalog-script';

const DEFAULT_FILE = 'prisma/data/popular-names.json';

/**
 * Writes the popular names of works ("Sonata ao Luar", "New World
 * Symphony") from the editorial list onto the catalog.
 *
 * Simulates by default and prints, for each entry, the works it matched:
 * read it before `--apply`. Entries that match nothing or more than a few
 * works are flagged. A name already on a work (a curator's edit) is kept
 * unless `--force`. Idempotent.
 *
 * Usage:
 *   node dist/scripts/import-popular-names.js [--file=list.json]          # dry run
 *   node dist/scripts/import-popular-names.js [--file=list.json] --apply  # writes
 */
void runCatalogScript(
  'ImportPopularNames',
  async ({ prisma, apply, logger, args }) => {
    const force = process.argv.includes('--force');
    const entries = JSON.parse(
      readFileSync(args.file ?? DEFAULT_FILE, 'utf-8'),
    ) as PopularNameEntry[];

    const porCompositor = new Map<string, CatalogWork[]>();
    for (const c of new Set(entries.map((e) => e.c))) {
      porCompositor.set(
        c,
        await prisma.work.findMany({
          where: { imslpPermlink: { contains: `(${c})` } },
          select: {
            id: true,
            title: true,
            imslpPermlink: true,
            popularName: true,
            popularNameEn: true,
            famousParts: true,
            famousPartsEn: true,
          },
        }),
      );
    }

    const matches = matchPopularNames(
      entries,
      (c) => porCompositor.get(c) ?? [],
    );
    let escritas = 0;
    const vazias: string[] = [];
    const largas: string[] = [];

    for (const { entry, works } of matches) {
      const rotulo = `${entry.c} · ${entry.pt ?? entry.partes?.pt.join(', ')}`;
      if (!works.length) {
        vazias.push(rotulo);
        continue;
      }
      if (works.length > TOO_MANY) largas.push(`${rotulo} (${works.length})`);
      logger.log(`${rotulo} ← ${works.map((w) => w.title).join(' | ')}`);
      for (const work of works) {
        const data = changesFor(work, entry, force);
        if (!Object.keys(data).length) continue;
        escritas++;
        if (apply) await prisma.work.update({ where: { id: work.id }, data });
      }
    }

    logger.log(
      `${apply ? 'Gravadas' : '[simulação] gravaria'}: ${escritas} obras, ` +
        `de ${matches.length} nomes (${vazias.length} sem obra no acervo)`,
    );
    if (vazias.length) logger.warn(`Sem obra no acervo: ${vazias.join('; ')}`);
    if (largas.length)
      logger.warn(
        `Padrões que casaram muitas obras (conferir): ${largas.join('; ')}`,
      );
  },
);
