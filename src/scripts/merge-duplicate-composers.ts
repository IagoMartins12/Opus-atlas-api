import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AppModule } from '../app.module';
import { CATALOG_NAMESPACES } from '../common/cache/cache-keys';
import { AppCacheService } from '../common/cache/cache.service';
import { errorMessage } from '../common/utils/error.util';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Merges composers registered twice: same name (full name, case and spaces
 * ignored) and same birth and death years.
 *
 * A group with no year at all is left alone: two people can share a name,
 * and without dates nothing says they are the same person.
 *
 * In each group the one that stays is the one with most works (then the
 * verified one, the one with a biography, a portrait, the oldest record).
 * Everything that points at the others moves to it: works, favorites (a
 * person who favorited both keeps one), curiosities, "favorite composer" in
 * profiles, blog articles and events, collections, contributions, reports
 * and upload history. Fields empty on the one that stays are filled from
 * the others (biography, portrait, links, dates). Then the others go.
 *
 *   node dist/scripts/merge-duplicate-composers.js           # simulates
 *   node dist/scripts/merge-duplicate-composers.js --apply   # writes
 */

type Row = {
  id: string;
  name: string;
  fullName: string | null;
  birthYear: number | null;
  deathYear: number | null;
  bio: string | null;
  bioEn: string | null;
  portraitUrl: string | null;
  videoUrl: string | null;
  wikipediaLink: string | null;
  permLinkImslp: string | null;
  imslpId: string | null;
  nationality: string | null;
  birthDate: string | null;
  deathDate: string | null;
  alternativeNames: string | null;
  isVerified: boolean;
  createdAt: Date;
  _count: { works: number };
};

const FILLABLE = [
  'bio',
  'bioEn',
  'portraitUrl',
  'videoUrl',
  'wikipediaLink',
  'permLinkImslp',
  'imslpId',
  'nationality',
  'birthDate',
  'deathDate',
] as const;

const key = (c: Row) =>
  [
    (c.fullName || c.name).trim().replace(/\s+/g, ' ').toLowerCase(),
    c.birthYear ?? '',
    c.deathYear ?? '',
  ].join('|');

/** The one that stays: most works, then verified, bio, portrait, oldest. */
const rank = (a: Row, b: Row) =>
  b._count.works - a._count.works ||
  Number(b.isVerified) - Number(a.isVerified) ||
  Number(!!b.bio) - Number(!!a.bio) ||
  Number(!!b.portraitUrl) - Number(!!a.portraitUrl) ||
  a.createdAt.getTime() - b.createdAt.getTime();

async function main() {
  const apply = process.argv.includes('--apply');
  const logger = new Logger('MergeDuplicateComposers');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);

  try {
    const all = (await prisma.composer.findMany({
      where: {
        OR: [{ birthYear: { not: null } }, { deathYear: { not: null } }],
      },
      select: {
        id: true,
        name: true,
        fullName: true,
        birthYear: true,
        deathYear: true,
        bio: true,
        bioEn: true,
        portraitUrl: true,
        videoUrl: true,
        wikipediaLink: true,
        permLinkImslp: true,
        imslpId: true,
        nationality: true,
        birthDate: true,
        deathDate: true,
        alternativeNames: true,
        isVerified: true,
        createdAt: true,
      },
    })) as Omit<Row, '_count'>[];

    const byKey = new Map<string, Omit<Row, '_count'>[]>();
    for (const c of all) {
      const k = key(c as Row);
      byKey.set(k, [...(byKey.get(k) ?? []), c]);
    }
    // Works are counted only for composers in a group: counting the whole
    // catalog's works per composer takes minutes.
    const candidates = [...byKey.values()].filter((g) => g.length > 1);
    const counts = await prisma.work.groupBy({
      by: ['composerId'],
      where: { composerId: { in: candidates.flat().map((c) => c.id) } },
      _count: { _all: true },
    });
    const worksOf = new Map(counts.map((c) => [c.composerId, c._count._all]));
    const dupes: Row[][] = candidates.map((g) =>
      g.map((c) => ({ ...c, _count: { works: worksOf.get(c.id) ?? 0 } })),
    );

    let removed = 0;
    let movedWorks = 0;
    for (const group of dupes) {
      const [keep, ...others] = [...group].sort(rank);
      const ids = others.map((o) => o.id);
      const works = others.reduce((n, o) => n + o._count.works, 0);
      logger.log(
        `${keep.fullName || keep.name} (${keep.birthYear ?? '?'}–${keep.deathYear ?? '?'}): fica ${keep.id}, sai(em) ${ids.join(', ')} · ${works} obra(s) movida(s)`,
      );
      removed += ids.length;
      movedWorks += works;
      if (!apply) continue;

      // Fields the one that stays lacks, from the first other that has them.
      const fill: Prisma.ComposerUpdateInput = {};
      for (const field of FILLABLE) {
        if (keep[field]) continue;
        const from = others.find((o) => o[field]);
        if (from) (fill as Record<string, unknown>)[field] = from[field];
      }
      const names = new Set(
        [keep.alternativeNames, ...others.map((o) => o.alternativeNames)]
          .flatMap((n) => (n ?? '').split(','))
          .map((n) => n.trim())
          .filter(Boolean),
      );
      if (names.size) fill.alternativeNames = [...names].join(', ');

      await prisma.work.updateMany({
        where: { composerId: { in: ids } },
        data: { composerId: keep.id },
      });

      // A person who favorited both keeps one favorite.
      const favorites = await prisma.favoriteComposer.findMany({
        where: { composerId: { in: [keep.id, ...ids] } },
        select: { id: true, userId: true, composerId: true },
      });
      const already = new Set(
        favorites.filter((f) => f.composerId === keep.id).map((f) => f.userId),
      );
      for (const f of favorites.filter((f) => f.composerId !== keep.id)) {
        if (already.has(f.userId)) {
          await prisma.favoriteComposer.delete({ where: { id: f.id } });
        } else {
          await prisma.favoriteComposer.update({
            where: { id: f.id },
            data: { composerId: keep.id },
          });
          already.add(f.userId);
        }
      }

      await prisma.composerCuriosity.updateMany({
        where: { composerId: { in: ids } },
        data: { composerId: keep.id },
      });
      await prisma.user.updateMany({
        where: { favoriteComposerId: { in: ids } },
        data: { favoriteComposerId: keep.id },
      });
      for (const model of [
        'contribution',
        'uploadModeration',
        'uploadHistory',
      ] as const) {
        await (
          prisma[model] as unknown as {
            updateMany: (a: unknown) => Promise<unknown>;
          }
        ).updateMany({
          where: { entityType: 'composer', entityId: { in: ids } },
          data: { entityId: keep.id },
        });
      }

      // Lists of composer ids: blog articles and events.
      const swap = (list: string[]) => [
        ...new Set(list.map((id) => (ids.includes(id) ? keep.id : id))),
      ];
      const articles = await prisma.blogArticle.findMany({
        where: { composerIds: { hasSome: ids } },
        select: { id: true, composerIds: true },
      });
      for (const a of articles)
        await prisma.blogArticle.update({
          where: { id: a.id },
          data: { composerIds: swap(a.composerIds) },
        });
      const events = await prisma.event.findMany({
        where: { composerIds: { hasSome: ids } },
        select: { id: true, composerIds: true },
      });
      for (const e of events)
        await prisma.event.update({
          where: { id: e.id },
          data: { composerIds: swap(e.composerIds) },
        });

      // Collections of composers keep their order, without repeating.
      const collections = await prisma.collection.findMany({
        where: { kind: 'COMPOSER' },
        select: { id: true, items: true },
      });
      for (const c of collections) {
        if (!c.items.some((i) => ids.includes(i.refId))) continue;
        const seen = new Set<string>();
        const items = c.items
          .map((i) => (ids.includes(i.refId) ? { ...i, refId: keep.id } : i))
          .filter((i) => !seen.has(i.refId) && seen.add(i.refId));
        await prisma.collection.update({
          where: { id: c.id },
          data: { items },
        });
      }

      await prisma.composer.deleteMany({ where: { id: { in: ids } } });
      if (Object.keys(fill).length)
        await prisma.composer.update({ where: { id: keep.id }, data: fill });
    }

    if (apply)
      await app.get(AppCacheService).invalidateMany(CATALOG_NAMESPACES);
    logger.log(
      `${apply ? 'Fundidos' : '[simulação] fundiria'}: ${dupes.length} grupo(s), ${removed} compositor(es) a menos, ${movedWorks} obra(s) movida(s)`,
    );
  } catch (error: unknown) {
    logger.error(`Falha: ${errorMessage(error)}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
