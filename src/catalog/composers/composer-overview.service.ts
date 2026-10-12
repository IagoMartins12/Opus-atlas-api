import { Injectable, NotFoundException } from '@nestjs/common';
import { CacheNamespace } from '../../common/cache/cache-keys';
import { AppCacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_COMPOSER } from './composer-role';
import {
  ComposerOverviewDto,
  ContemporaryDto,
  StartingPointDto,
  WrittenForDto,
} from './dto/composer-overview.dto';

const OVERVIEW_TTL_MS = 60 * 60 * 1000;
const WRITTEN_FOR_LIMIT = 5;
/**
 * Works sent for "where to start". The site shows as many as fit the
 * person's study horizon (two for months, up to five for a lifetime), so the
 * cached answer carries the most anyone needs.
 */
const STARTING_POINTS = 5;
/** Candidates for "where to start" before ordering by difficulty. */
const STARTING_POOL = 10;
const CONTEMPORARIES = 15;
/** Pool sampled for contemporaries: big enough to vary, small to read. */
const CONTEMPORARY_POOL = 600;
/** For living composers or unknown deaths, "same time" ends a century later. */
const OPEN_LIFESPAN = 90;

/**
 * What the composer page shows around the biography: what they wrote for,
 * where to start, and who was alive at the same time. One cached response
 * (an hour) so the page makes a single request for all three.
 */
@Injectable()
export class ComposerOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AppCacheService,
  ) {}

  getOverview(id: string): Promise<ComposerOverviewDto> {
    return this.cache.remember(
      `${CacheNamespace.COMPOSERS}:overview:v1:${id}`,
      { ttlMs: OVERVIEW_TTL_MS, metricRoute: 'composers/overview' },
      () => this.load(id),
    );
  }

  private async load(id: string): Promise<ComposerOverviewDto> {
    const composer = await this.prisma.composer.findUnique({
      where: { id },
      select: {
        id: true,
        birthYear: true,
        deathYear: true,
        startingWorkIds: true,
      },
    });
    if (!composer) throw new NotFoundException('Composer not found');

    const [writtenFor, startingPoints, contemporaries] = await Promise.all([
      this.writtenFor(id),
      this.startingPoints(id, composer.startingWorkIds ?? []),
      this.contemporaries(composer),
    ]);
    return { writtenFor, startingPoints, contemporaries };
  }

  private async writtenFor(composerId: string): Promise<WrittenForDto[]> {
    const groups = await this.prisma.work.groupBy({
      by: ['instrumentId'],
      where: { composerId, parentWorkId: null },
      _count: { _all: true },
      orderBy: { _count: { instrumentId: 'desc' } },
      take: WRITTEN_FOR_LIMIT,
    });
    if (!groups.length) return [];
    const instruments = await this.prisma.instrument.findMany({
      where: { id: { in: groups.map((g) => g.instrumentId) } },
      select: { id: true, name: true },
    });
    const names = new Map(instruments.map((i) => [i.id, i.name]));
    return groups
      .filter((g) => names.has(g.instrumentId))
      .map((g) => ({
        instrumentId: g.instrumentId,
        name: names.get(g.instrumentId)!,
        works: g._count._all,
      }));
  }

  /**
   * The team's picks first, in their order; the rest automatic: the most
   * studied works (want to learn + learned + favorites), media as the
   * tie-breaker, and of those the easiest, in order of difficulty.
   */
  private async startingPoints(
    composerId: string,
    curatedIds: string[],
  ): Promise<StartingPointDto[]> {
    const works = await this.prisma.work.findMany({
      where: { composerId, parentWorkId: null },
      select: {
        id: true,
        title: true,
        opOrCatalog: true,
        difficultyLevel: true,
        spotifyTrackId: true,
        youtubeVideoId: true,
        instrument: { select: { name: true } },
      },
    });
    if (!works.length) return [];

    const ids = works.map((w) => w.id);
    const [wanting, learned, favorited] = await Promise.all([
      this.prisma.wantToLearn.groupBy({
        by: ['workId'],
        where: { workId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.learned.groupBy({
        by: ['workId'],
        where: { workId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.favoriteWork.groupBy({
        by: ['workId'],
        where: { workId: { in: ids } },
        _count: { _all: true },
      }),
    ]);
    const wantBy = new Map(wanting.map((g) => [g.workId, g._count._all]));
    const learnedBy = new Map(learned.map((g) => [g.workId, g._count._all]));
    const favoriteBy = new Map(favorited.map((g) => [g.workId, g._count._all]));

    const scored = works.map((w) => {
      const difficulty = Number.parseInt(w.difficultyLevel ?? '', 10);
      return {
        work: w,
        studying: wantBy.get(w.id) ?? 0,
        learned: learnedBy.get(w.id) ?? 0,
        favorites: favoriteBy.get(w.id) ?? 0,
        hasMedia: Boolean(w.spotifyTrackId || w.youtubeVideoId),
        difficulty: Number.isFinite(difficulty) ? difficulty : null,
      };
    });
    const byDifficulty = (a: number | null, b: number | null) =>
      (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER);

    const toDto = (s: (typeof scored)[number], curated: boolean) => ({
      id: s.work.id,
      title: s.work.title,
      opOrCatalog: s.work.opOrCatalog,
      instrumentName: s.work.instrument?.name ?? null,
      difficulty: s.difficulty,
      studying: s.studying,
      learned: s.learned,
      curated,
    });
    const curated = curatedIds
      .map((id) => scored.find((s) => s.work.id === id))
      .filter((s): s is (typeof scored)[number] => !!s)
      .slice(0, STARTING_POINTS);
    const automatic = scored
      .filter((s) => !curatedIds.includes(s.work.id))
      .sort(
        (a, b) =>
          b.studying +
            b.learned +
            b.favorites -
            (a.studying + a.learned + a.favorites) ||
          Number(b.hasMedia) - Number(a.hasMedia) ||
          byDifficulty(a.difficulty, b.difficulty),
      )
      .slice(0, STARTING_POOL)
      .sort((a, b) => byDifficulty(a.difficulty, b.difficulty))
      .slice(0, STARTING_POINTS - curated.length);

    return [
      ...curated.map((s) => toDto(s, true)),
      ...automatic.map((s) => toDto(s, false)),
    ];
  }

  /** Random composers (with a real portrait) whose lives overlapped. */
  private async contemporaries(composer: {
    id: string;
    birthYear: number | null;
    deathYear: number | null;
  }): Promise<ContemporaryDto[]> {
    if (!composer.birthYear) return [];
    const from = composer.birthYear;
    const to = composer.deathYear ?? from + OPEN_LIFESPAN;

    const pool = await this.prisma.composer.findMany({
      where: {
        AND: [
          IS_COMPOSER,
          { id: { not: composer.id } },
          { hasValidImage: true },
          { birthYear: { lte: to, gte: from - OPEN_LIFESPAN } },
          {
            OR: [
              { deathYear: { gte: from } },
              { deathYear: null, birthYear: { gte: from - OPEN_LIFESPAN } },
            ],
          },
        ],
      },
      select: { id: true },
      take: CONTEMPORARY_POOL,
    });
    const picked = shuffle(pool.map((p) => p.id)).slice(0, CONTEMPORARIES);
    if (!picked.length) return [];

    const rows = await this.prisma.composer.findMany({
      where: { id: { in: picked } },
      select: {
        id: true,
        name: true,
        fullName: true,
        portraitUrl: true,
        birthYear: true,
        deathYear: true,
      },
    });
    return rows.sort((a, b) => (a.birthYear ?? 0) - (b.birthYear ?? 0));
  }
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
