import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { CuriositySource } from '@prisma/client';
import { readFileSync } from 'fs';
import { AppModule } from '../app.module';
import { errorMessage } from '../common/utils/error.util';
import { PrismaService } from '../prisma/prisma.service';

interface EditorialEntry {
  name: string;
  /** The composer's spelling in the catalog, when the front used another. */
  dbName?: string;
  curiosities: { pt: string; en: string }[];
}

const DEFAULT_FILE = 'prisma/data/composer-curiosities.json';

/** Case, accents and stray spaces aside: "Leos Janácek" finds "Leoš Janáček". */
const normalize = (name: string) =>
  name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Moves the fixed curiosities the front kept in `getComposerCuriosities`
 * (keyed by full name) into `composer_curiosities`, one row per language,
 * as EDITORIAL. People's curiosities sit beside them from then on.
 *
 * Names are compared without case or accents; `dbName` covers the ones the
 * front spelled differently. A name with duplicate composers goes to the
 * one with the most works.
 * Idempotent: a text already there is skipped.
 *
 * Usage:
 *   node dist/scripts/import-editorial-curiosities.js [file.json]           # dry run
 *   node dist/scripts/import-editorial-curiosities.js [file.json] --apply   # writes
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const file =
    process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? DEFAULT_FILE;
  const logger = new Logger('ImportEditorialCuriosities');
  const entries = JSON.parse(readFileSync(file, 'utf-8')) as EditorialEntry[];

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  let created = 0;
  let skipped = 0;
  const missing: string[] = [];

  try {
    const byName = new Map<string, string[]>();
    for (const { id, fullName } of await prisma.composer.findMany({
      select: { id: true, fullName: true },
    })) {
      const key = normalize(fullName);
      byName.set(key, [...(byName.get(key) ?? []), id]);
    }

    for (const entry of entries) {
      const ids = byName.get(normalize(entry.dbName ?? entry.name));
      if (!ids) {
        missing.push(entry.name);
        continue;
      }
      const composer =
        ids.length === 1
          ? { id: ids[0] }
          : await prisma.composer.findFirst({
              where: { id: { in: ids } },
              orderBy: { works: { _count: 'desc' } },
              select: { id: true },
            });
      if (!composer) continue;

      const rows = entry.curiosities.flatMap((c) => [
        { language: 'pt', text: c.pt },
        { language: 'en', text: c.en },
      ]);
      for (const row of rows) {
        const exists = await prisma.composerCuriosity.findFirst({
          where: {
            composerId: composer.id,
            language: row.language,
            text: row.text,
          },
          select: { id: true },
        });
        if (exists) {
          skipped++;
          continue;
        }
        created++;
        if (apply) {
          await prisma.composerCuriosity.create({
            data: {
              composerId: composer.id,
              source: CuriositySource.EDITORIAL,
              ...row,
            },
          });
        }
      }
    }

    logger.log(
      `${apply ? 'Gravadas' : '[simulação] gravaria'}: ${created} curiosidades ` +
        `(${skipped} já existiam; ${missing.length} nomes fora do banco)`,
    );
    if (missing.length) logger.warn(`Fora do banco: ${missing.join(', ')}`);
  } catch (error: unknown) {
    logger.error(`Falha: ${errorMessage(error)}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    new Logger('ImportEditorialCuriosities').error(
      `Erro fatal: ${errorMessage(error)}`,
    );
    process.exit(1);
  });
