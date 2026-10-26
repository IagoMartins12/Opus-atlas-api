import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import {
  CatalogWork,
  PopularNameEntry,
  TOO_MANY,
  changesFor,
  matchPopularNames,
} from '../catalog/works/popular-names/popular-names';
import { errorMessage } from '../common/utils/error.util';

const DEFAULT_FILE = 'prisma/data/popular-names.json';

/**
 * Writes the popular names of works ("Sonata ao Luar", "New World
 * Symphony") and their famous parts from the editorial list onto the
 * catalog.
 *
 * Simulates by default and prints, for each entry, the works it matched:
 * read it before `--apply`. Entries that match nothing or more than a few
 * works are flagged. A name already on a work (a curator's edit) is kept
 * unless `--force`. Idempotent.
 *
 * **Only the database, not the application.** It used to boot the whole API
 * (`runCatalogScript`), which connects to Redis — and the homologation Redis
 * answers only by its internal name inside Render, so run from a laptop the
 * script died before reading anything. The API caches the works for up to an
 * hour: restart it (a deploy does) to show the names at once.
 *
 * Usage:
 *   node dist/scripts/import-popular-names.js [--file=list.json]          # dry run
 *   node dist/scripts/import-popular-names.js [--file=list.json] --apply  # writes
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');
  const file =
    process.argv.find((a) => a.startsWith('--file='))?.slice(7) ?? DEFAULT_FILE;
  const logger = new Logger('ImportPopularNames');
  const prisma = new PrismaClient();

  try {
    logger.log(apply ? 'GRAVANDO (--apply)' : 'Simulação: nada é gravado');
    const entries = JSON.parse(
      readFileSync(file, 'utf-8'),
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
    if (apply && escritas)
      logger.log(
        'Reinicie a API para os nomes aparecerem já (o cache das obras dura até 1 hora).',
      );
  } catch (error: unknown) {
    logger.error(`Falha: ${errorMessage(error)}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
