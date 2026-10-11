import { NotFoundException } from '@nestjs/common';
import { ComposerOverviewService } from './composer-overview.service';

const passthroughCache = {
  remember: (_key: string, _opts: unknown, load: () => Promise<unknown>) =>
    load(),
};

function build(prisma: Record<string, unknown>) {
  return new ComposerOverviewService(
    prisma as never,
    passthroughCache as never,
  );
}

const work = (id: string, difficultyLevel: string | null, media = false) => ({
  id,
  title: `Work ${id}`,
  opOrCatalog: null,
  difficultyLevel,
  spotifyTrackId: media ? 'sp' : null,
  youtubeVideoId: null,
  instrument: { name: 'Piano' },
});

describe('ComposerOverviewService', () => {
  it('404s for an unknown composer', async () => {
    const service = build({
      composer: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(service.getOverview('x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('starts with the easiest of the most studied works', async () => {
    const works = [
      work('hard-popular', '9'),
      work('easy-popular', '2'),
      work('mid-popular', '5'),
      work('easy-unknown', '1'),
    ];
    const groupByStudy = jest.fn().mockResolvedValue([
      { workId: 'hard-popular', _count: { _all: 30 } },
      { workId: 'easy-popular', _count: { _all: 20 } },
      { workId: 'mid-popular', _count: { _all: 10 } },
    ]);
    const service = build({
      composer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c',
          birthYear: null,
          deathYear: null,
          startingWorkIds: [],
        }),
      },
      work: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue(works),
      },
      instrument: { findMany: jest.fn() },
      wantToLearn: { groupBy: groupByStudy },
      learned: { groupBy: jest.fn().mockResolvedValue([]) },
      favoriteWork: { groupBy: jest.fn().mockResolvedValue([]) },
    });

    const overview = await service.getOverview('c');

    // All four fit in the pool of ten; ordered by difficulty, top three.
    expect(overview.startingPoints.map((s) => s.id)).toEqual([
      'easy-unknown',
      'easy-popular',
      'mid-popular',
    ]);
    expect(overview.startingPoints[1]).toMatchObject({
      difficulty: 2,
      studying: 20,
    });
    // No birth year: no contemporaries, and no query for them.
    expect(overview.contemporaries).toEqual([]);
  });

  // The team's picks lead, in their order; the automatic ones fill the rest.
  it('puts the curated works first and completes with the automatic ones', async () => {
    const works = [
      work('hard-popular', '9'),
      work('easy-popular', '2'),
      work('mid-popular', '5'),
      work('easy-unknown', '1'),
    ];
    const service = build({
      composer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c',
          birthYear: null,
          deathYear: null,
          startingWorkIds: ['hard-popular', 'gone'],
        }),
      },
      work: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue(works),
      },
      instrument: { findMany: jest.fn() },
      wantToLearn: { groupBy: jest.fn().mockResolvedValue([]) },
      learned: { groupBy: jest.fn().mockResolvedValue([]) },
      favoriteWork: { groupBy: jest.fn().mockResolvedValue([]) },
    });

    const overview = await service.getOverview('c');

    expect(overview.startingPoints.map((s) => [s.id, s.curated])).toEqual([
      ['hard-popular', true],
      ['easy-unknown', false],
      ['easy-popular', false],
    ]);
  });

  it('names the top instrumentations', async () => {
    const service = build({
      composer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c',
          birthYear: null,
          deathYear: null,
          startingWorkIds: [],
        }),
      },
      work: {
        groupBy: jest.fn().mockResolvedValue([
          { instrumentId: 'i1', _count: { _all: 158 } },
          { instrumentId: 'i2', _count: { _all: 19 } },
        ]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      instrument: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'i1', name: 'Piano' },
          { id: 'i2', name: 'Voz e piano' },
        ]),
      },
    });

    const overview = await service.getOverview('c');

    expect(overview.writtenFor).toEqual([
      { instrumentId: 'i1', name: 'Piano', works: 158 },
      { instrumentId: 'i2', name: 'Voz e piano', works: 19 },
    ]);
  });
});
