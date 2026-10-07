import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { composerDateParts } from '../common/dates/loose-date';

/**
 * Fills `birthYear/Month/Day` and `deathYear/Month/Day` from the text dates
 * of every composer. Idempotent: only writes records whose parts changed.
 *
 * Usage:
 *   node --env-file=.env.local dist/scripts/backfill-composer-date-parts.js           # dry run
 *   node --env-file=.env.local dist/scripts/backfill-composer-date-parts.js --apply
 */
const PAGE = 1000;
const PARALLEL = 50;
const KEYS = [
  'birthYear',
  'birthMonth',
  'birthDay',
  'deathYear',
  'deathMonth',
  'deathDay',
] as const;

async function main() {
  const apply = process.argv.includes('--apply');
  const logger = new Logger('BackfillComposerDateParts');
  const prisma = new PrismaClient();
  let cursor: string | undefined;
  let seen = 0;
  let changed = 0;
  let withYear = 0;

  try {
    for (;;) {
      const page = await prisma.composer.findMany({
        take: PAGE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
        select: {
          id: true,
          birthDate: true,
          deathDate: true,
          birthYear: true,
          birthMonth: true,
          birthDay: true,
          deathYear: true,
          deathMonth: true,
          deathDay: true,
        },
      });
      if (!page.length) break;
      cursor = page[page.length - 1].id;
      seen += page.length;

      const updates = page
        .map((composer) => {
          const parts = composerDateParts({
            birthDate: composer.birthDate,
            deathDate: composer.deathDate,
          });
          if (parts.birthYear) withYear++;
          const differs = KEYS.some((k) => (parts[k] ?? null) !== composer[k]);
          return differs ? { id: composer.id, parts } : null;
        })
        .filter((u): u is NonNullable<typeof u> => u !== null);
      changed += updates.length;

      if (apply) {
        for (let i = 0; i < updates.length; i += PARALLEL) {
          await Promise.all(
            updates
              .slice(i, i + PARALLEL)
              .map((u) =>
                prisma.composer.update({ where: { id: u.id }, data: u.parts }),
              ),
          );
        }
      }
    }
    logger.log(
      `${seen} composers, ${withYear} with a birth year, ${changed} ${
        apply ? 'updated' : 'would change (dry run)'
      }`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
