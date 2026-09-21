import { NotFoundException } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { PrismaService } from '../../prisma/prisma.service';
import { InstrumentsService } from './instruments.service';

describe('InstrumentsService', () => {
  let prisma: {
    instrument: { findMany: jest.Mock; findUnique: jest.Mock };
    work: { count: jest.Mock; groupBy: jest.Mock };
    userInstrument: { count: jest.Mock };
    composer: { findMany: jest.Mock };
  };
  let cache: { get: jest.Mock; set: jest.Mock };
  let service: InstrumentsService;

  beforeEach(() => {
    prisma = {
      instrument: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'i1', name: 'Piano', category: ' Teclado ', difficulty: '' },
          ]),
        findUnique: jest.fn().mockResolvedValue({ id: 'i1', name: 'Piano' }),
      },
      work: {
        count: jest.fn().mockResolvedValue(900),
        groupBy: jest.fn().mockResolvedValue([
          { composerId: 'c2', _count: { composerId: 40 } },
          { composerId: 'c1', _count: { composerId: 12 } },
          { composerId: 'sumiu', _count: { composerId: 3 } },
        ]),
      },
      userInstrument: { count: jest.fn().mockResolvedValue(7) },
      composer: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'c1', name: 'Bach', fullName: 'J. S. Bach', portraitUrl: null },
          { id: 'c2', name: 'Chopin', fullName: null, portraitUrl: 'p.jpg' },
        ]),
      },
    };
    cache = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() };
    service = new InstrumentsService(
      prisma as unknown as PrismaService,
      cache as unknown as Cache,
    );
  });

  it('lista com texto vazio virando null, e guarda em cache', async () => {
    await expect(service.findAll()).resolves.toEqual([
      { id: 'i1', name: 'Piano', category: 'Teclado', difficulty: null },
    ]);
    expect(cache.set).toHaveBeenCalledWith(
      'instruments:list',
      expect.any(Array),
      expect.any(Number),
    );
  });

  it('lista em cache não vai ao banco', async () => {
    cache.get.mockResolvedValue([{ id: 'x' }]);

    await expect(service.findAll()).resolves.toEqual([{ id: 'x' }]);
    expect(prisma.instrument.findMany).not.toHaveBeenCalled();
  });

  // O ranking é contado no banco, e não trazendo as obras para a memória.
  it('estatísticas: top compositores agrupados no banco, na ordem da contagem', async () => {
    const stats = await service.getStats('i1');

    expect(prisma.work.groupBy).toHaveBeenCalledWith({
      by: ['composerId'],
      where: { instrumentId: 'i1' },
      _count: { composerId: true },
      orderBy: { _count: { composerId: 'desc' } },
      take: 5,
    });
    expect(stats).toEqual({
      instrumentId: 'i1',
      instrumentName: 'Piano',
      worksCount: 900,
      usersCount: 7,
      topComposers: [
        {
          id: 'c2',
          name: 'Chopin',
          fullName: null,
          portraitUrl: 'p.jpg',
          worksCount: 40,
        },
        {
          id: 'c1',
          name: 'Bach',
          fullName: 'J. S. Bach',
          portraitUrl: null,
          worksCount: 12,
        },
      ],
    });
  });

  it('estatísticas em cache e instrumento inexistente', async () => {
    cache.get.mockResolvedValueOnce({ instrumentId: 'i1' });
    await expect(service.getStats('i1')).resolves.toEqual({
      instrumentId: 'i1',
    });

    prisma.instrument.findUnique.mockResolvedValue(null);
    await expect(service.getStats('x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // A vitrine da página de instrumentos: a curadoria que o front aplicava
  // lendo o banco, agora na API (Etapa 3).
  describe('vitrine', () => {
    let findWorks: jest.Mock;
    const work = (id: string) => ({
      id,
      title: id,
      opOrCatalog: null,
      compositionYear: null,
      tone: null,
      mediaDuration: null,
      imslpPermlink: 'p',
      videoUrl: null,
      composer: {
        id: 'c',
        name: 'C',
        fullName: null,
        portraitUrl: null,
        epochName: null,
      },
    });

    beforeEach(() => {
      prisma.instrument.findMany.mockResolvedValue([
        { id: 'harpa', name: 'Harpa' },
        { id: 'piano', name: 'piano' },
        { id: 'orq', name: 'Orquestra' },
        { id: 'vln', name: 'Violino' },
      ]);
      findWorks = jest
        .fn()
        .mockImplementation(({ take }: { take?: number }) =>
          Promise.resolve(
            Array.from({ length: take ?? 1 }, (_, i) => work(`w${i}`)),
          ),
        );
      (prisma.work as unknown as Record<string, jest.Mock>).findMany =
        findWorks;
      (prisma.composer as unknown as Record<string, jest.Mock>).findUnique =
        jest.fn().mockResolvedValue({
          id: '685f0770c6bd886c5b4982af',
          name: 'Paganini',
          fullName: null,
          portraitUrl: null,
          epochName: 'Romântico',
        });
    });

    it('na ordem da curadoria, só os instrumentos que existem, e em cache', async () => {
      const showcase = await service.getShowcase();

      expect(showcase.map((item) => item.id)).toEqual([
        'piano',
        'vln',
        'orq',
        'harpa',
      ]);
      expect(showcase[0]).toMatchObject({ totalWorks: 900, totalUsers: 7 });
      expect(cache.set).toHaveBeenCalledWith(
        'instruments:showcase:v1',
        showcase,
        expect.any(Number),
      );
    });

    it('compositor em destaque: as obras e o ranking são só dele', async () => {
      const showcase = await service.getShowcase();

      expect(findWorks).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            instrumentId: 'vln',
            composerId: '685f0770c6bd886c5b4982af',
          },
          take: 20,
        }),
      );
      expect(showcase.find((item) => item.id === 'vln')?.topComposers).toEqual([
        { composer: expect.objectContaining({ name: 'Paganini' }), count: 900 },
      ]);
    });

    it('piano: as obras escolhidas do compositor e o resto completando até 20', async () => {
      const showcase = await service.getShowcase();

      expect(findWorks).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            instrumentId: 'piano',
            composerId: '683bb049320ed96f5ac321a8',
            id: { notIn: [] },
          },
          take: 3,
        }),
      );
      expect(findWorks).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { instrumentId: 'piano', id: { notIn: ['w0', 'w1', 'w2'] } },
          take: 17,
        }),
      );
      expect(showcase[0].works).toHaveLength(20);
    });

    it('orquestra: compositor excluído fora das obras e do ranking', async () => {
      await service.getShowcase();

      const excluded = { notIn: ['683a7e9af8ced962eff7c0d8'] };
      expect(findWorks).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { instrumentId: 'orq', composerId: excluded },
          take: 20,
        }),
      );
      expect(prisma.work.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { instrumentId: 'orq', composerId: excluded },
          take: 5,
        }),
      );
    });

    it('vitrine em cache não vai ao banco', async () => {
      cache.get.mockResolvedValue([{ id: 'x' }]);

      await expect(service.getShowcase()).resolves.toEqual([{ id: 'x' }]);
      expect(prisma.instrument.findMany).not.toHaveBeenCalled();
    });
  });
});
