import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { AchievementStatsService } from './achievement-stats.service';

/** Data a N dias atrás, à meia-noite local. */
const daysAgo = (days: number): Date => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(12, 0, 0, 0);
  return date;
};

describe('AchievementStatsService', () => {
  let service: AchievementStatsService;
  let prisma: Record<string, Record<string, jest.Mock>>;

  beforeEach(async () => {
    prisma = {
      wantToLearn: { findMany: jest.fn().mockResolvedValue([]) },
      learned: { findMany: jest.fn().mockResolvedValue([]) },
      favoriteComposer: { findMany: jest.fn().mockResolvedValue([]) },
      favoriteWork: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      favoriteScore: { findMany: jest.fn().mockResolvedValue([]) },
      workAnnotation: { count: jest.fn().mockResolvedValue(0) },
      annotationHelpfulVote: { count: jest.fn().mockResolvedValue(0) },
      composer: { count: jest.fn().mockResolvedValue(0) },
      work: { count: jest.fn().mockResolvedValue(0) },
      workScore: { count: jest.fn().mockResolvedValue(0) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AchievementStatsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AchievementStatsService);
  });

  it('devolve tudo zerado para usuário sem atividade', async () => {
    const stats = await service.collect('user-1');

    expect(stats.totalFavorites).toBe(0);
    expect(stats.totalLearning).toBe(0);
    expect(stats.avgMastery).toBe(0);
    expect(stats.learningStreak).toBe(0);
  });

  it('soma as três formas de favoritar', async () => {
    prisma.favoriteComposer.findMany.mockResolvedValue([
      { createdAt: new Date() },
      { createdAt: new Date() },
    ]);
    prisma.favoriteWork.findMany.mockResolvedValue([
      {
        createdAt: new Date(),
        work: { composerId: 'c1', epochId: 'e1', instrumentId: 'i1' },
      },
    ]);
    prisma.favoriteScore.findMany.mockResolvedValue([{ addedAt: new Date() }]);

    const stats = await service.collect('user-1');

    expect(stats.totalFavorites).toBe(4);
  });

  it('conta épocas e instrumentos distintos entre as obras favoritas', async () => {
    prisma.favoriteWork.findMany.mockResolvedValue([
      {
        createdAt: new Date(),
        work: { composerId: 'c1', epochId: 'e1', instrumentId: 'i1' },
      },
      {
        createdAt: new Date(),
        work: { composerId: 'c1', epochId: 'e1', instrumentId: 'i2' },
      },
      {
        createdAt: new Date(),
        work: { composerId: 'c2', epochId: 'e2', instrumentId: 'i1' },
      },
    ]);

    const stats = await service.collect('user-1');

    expect(stats.epochsCount).toBe(2);
    expect(stats.instrumentsCount).toBe(2);
  });

  it('mede o compositor mais favoritado, não a soma', async () => {
    prisma.favoriteWork.findMany.mockResolvedValue([
      {
        createdAt: new Date(),
        work: { composerId: 'bach', epochId: 'e1', instrumentId: 'i1' },
      },
      {
        createdAt: new Date(),
        work: { composerId: 'bach', epochId: 'e1', instrumentId: 'i1' },
      },
      {
        createdAt: new Date(),
        work: { composerId: 'bach', epochId: 'e1', instrumentId: 'i1' },
      },
      {
        createdAt: new Date(),
        work: { composerId: 'mozart', epochId: 'e2', instrumentId: 'i2' },
      },
    ]);

    const stats = await service.collect('user-1');

    expect(stats.topComposerWorks).toBe(3);
  });

  it('calcula maestria média e obras dominadas', async () => {
    prisma.learned.findMany.mockResolvedValue([
      {
        workId: 'w1',
        mastery: 5,
        learnedAt: new Date(),
        publicPerformance: false,
      },
      {
        workId: 'w2',
        mastery: 4,
        learnedAt: new Date(),
        publicPerformance: false,
      },
      {
        workId: 'w3',
        mastery: 3,
        learnedAt: new Date(),
        publicPerformance: false,
      },
    ]);

    const stats = await service.collect('user-1');

    expect(stats.avgMastery).toBe(4);
    expect(stats.expertLevelCount).toBe(2);
  });

  it('conta performances públicas', async () => {
    prisma.learned.findMany.mockResolvedValue([
      {
        workId: 'w1',
        mastery: 5,
        learnedAt: new Date(),
        publicPerformance: true,
      },
      {
        workId: 'w2',
        mastery: 5,
        learnedAt: new Date(),
        publicPerformance: false,
      },
    ]);

    const stats = await service.collect('user-1');

    expect(stats.publicPerformances).toBe(1);
  });

  describe('taxa de conclusão', () => {
    it('divide concluídas pelo total iniciado', async () => {
      prisma.wantToLearn.findMany.mockResolvedValue([
        { workId: 'w1', addedAt: new Date() },
      ]);
      prisma.learned.findMany.mockResolvedValue([
        {
          workId: 'w2',
          mastery: 5,
          learnedAt: new Date(),
          publicPerformance: false,
        },
        {
          workId: 'w3',
          mastery: 5,
          learnedAt: new Date(),
          publicPerformance: false,
        },
        {
          workId: 'w4',
          mastery: 5,
          learnedAt: new Date(),
          publicPerformance: false,
        },
      ]);

      const stats = await service.collect('user-1');

      expect(stats.completionRate).toBe(75);
    });

    // Um usuário novo não é "100% eficiente" por nunca ter tentado nada.
    it('devolve zero para quem não começou nada', async () => {
      const stats = await service.collect('user-1');

      expect(stats.completionRate).toBe(0);
    });
  });

  describe('sequência de dias', () => {
    it('conta dias consecutivos', async () => {
      prisma.learned.findMany.mockResolvedValue([
        {
          workId: 'w1',
          mastery: 5,
          learnedAt: daysAgo(2),
          publicPerformance: false,
        },
        {
          workId: 'w2',
          mastery: 5,
          learnedAt: daysAgo(1),
          publicPerformance: false,
        },
        {
          workId: 'w3',
          mastery: 5,
          learnedAt: daysAgo(0),
          publicPerformance: false,
        },
      ]);

      const stats = await service.collect('user-1');

      expect(stats.learningStreak).toBe(3);
    });

    // Cinco obras concluídas na segunda-feira são um dia de sequência.
    it('conta dias distintos, não eventos', async () => {
      const today = daysAgo(0);
      prisma.learned.findMany.mockResolvedValue([
        {
          workId: 'w1',
          mastery: 5,
          learnedAt: today,
          publicPerformance: false,
        },
        {
          workId: 'w2',
          mastery: 5,
          learnedAt: today,
          publicPerformance: false,
        },
        {
          workId: 'w3',
          mastery: 5,
          learnedAt: today,
          publicPerformance: false,
        },
      ]);

      const stats = await service.collect('user-1');

      expect(stats.learningStreak).toBe(1);
    });

    it('quebra a sequência quando há um dia sem atividade', async () => {
      prisma.learned.findMany.mockResolvedValue([
        {
          workId: 'w1',
          mastery: 5,
          learnedAt: daysAgo(5),
          publicPerformance: false,
        },
        {
          workId: 'w2',
          mastery: 5,
          learnedAt: daysAgo(4),
          publicPerformance: false,
        },
        {
          workId: 'w3',
          mastery: 5,
          learnedAt: daysAgo(1),
          publicPerformance: false,
        },
        {
          workId: 'w4',
          mastery: 5,
          learnedAt: daysAgo(0),
          publicPerformance: false,
        },
      ]);

      const stats = await service.collect('user-1');

      expect(stats.learningStreak).toBe(2);
    });

    it('combina as três formas de favoritar na mesma sequência', async () => {
      prisma.favoriteComposer.findMany.mockResolvedValue([
        { createdAt: daysAgo(2) },
      ]);
      prisma.favoriteWork.findMany.mockResolvedValue([
        {
          createdAt: daysAgo(1),
          work: { composerId: 'c1', epochId: 'e1', instrumentId: 'i1' },
        },
      ]);
      prisma.favoriteScore.findMany.mockResolvedValue([
        { addedAt: daysAgo(0) },
      ]);

      const stats = await service.collect('user-1');

      expect(stats.favoriteStreak).toBe(3);
    });

    // Favoritos gravados antes de o campo de data existir não têm valor; entram
    // como ausentes em vez de virarem uma data inventada.
    it('ignora favoritos sem data na sequência', async () => {
      prisma.favoriteComposer.findMany.mockResolvedValue([
        { createdAt: null },
        { createdAt: null },
      ]);

      const stats = await service.collect('user-1');

      expect(stats.favoriteStreak).toBe(0);
      expect(stats.totalFavorites).toBe(2);
    });
  });

  it('soma as contribuições ao catálogo', async () => {
    prisma.composer.count.mockResolvedValue(2);
    prisma.work.count.mockResolvedValue(5);
    prisma.workScore.count.mockResolvedValue(3);

    const stats = await service.collect('user-1');

    expect(stats.contributions).toBe(10);
  });
});
