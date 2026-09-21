import { Cache } from 'cache-manager';
import { PrismaService } from '../../prisma/prisma.service';
import { DiscoveryService } from './discovery.service';

describe('DiscoveryService', () => {
  let prisma: {
    composer: { findMany: jest.Mock };
    work: { findMany: jest.Mock };
  };
  let cache: { get: jest.Mock; set: jest.Mock };
  let service: DiscoveryService;

  beforeEach(() => {
    const composers = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      name: `C${i}`,
      fullName: `Compositor ${i}`,
      portraitUrl: null,
      epoch: i % 2 ? { name: 'Barroco' } : null,
    }));
    const works = Array.from({ length: 10 }, (_, i) => ({
      id: `w${i}`,
      title: `Obra ${i}`,
      imslpPermlink: null,
      opOrCatalog: null,
      tone: null,
      composer: { id: 'c1', name: 'C1', fullName: null, portraitUrl: null },
      epoch: null,
      instrument: i % 2 ? { name: 'Violino' } : null,
    }));
    prisma = {
      composer: { findMany: jest.fn().mockResolvedValue(composers) },
      work: { findMany: jest.fn().mockResolvedValue(works) },
    };
    cache = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() };
    service = new DiscoveryService(
      prisma as unknown as PrismaService,
      cache as unknown as Cache,
    );
  });

  it('seis compositores menos conhecidos e seis obras, com rótulos padrão', async () => {
    const result = await service.getDiscoveries();

    expect(result.composers).toHaveLength(6);
    expect(result.works).toHaveLength(6);
    for (const composer of result.composers) {
      expect(['Barroco', 'Clássico']).toContain(composer.epochName);
    }
    for (const work of result.works) {
      expect(work.epochName).toBe('Clássico');
      expect(['Violino', 'Piano']).toContain(work.instrumentName);
    }
    // Os "óbvios" ficam fora.
    const [{ where }] = prisma.composer.findMany.mock.calls[0];
    expect(where.AND[1].fullName.notIn).toContain('Ludwig van Beethoven');
    expect(cache.set).toHaveBeenCalledWith(
      'discovery:discoveries:v1',
      result,
      60 * 60 * 1000,
    );
  });

  it('adições recentes com nomes achatados', async () => {
    prisma.composer.findMany.mockResolvedValue([{ id: 'c1' }]);
    prisma.work.findMany.mockResolvedValue([
      {
        id: 'w1',
        title: 'Nova',
        mediaDuration: '3:00',
        createdAt: new Date('2026-09-01'),
        composer: { fullName: 'Ana' },
        instrument: null,
        epoch: { name: 'Modernismo' },
      },
    ]);

    const result = await service.getRecentAdditions();

    expect(result.composers).toEqual([{ id: 'c1' }]);
    expect(result.works[0]).toEqual({
      id: 'w1',
      title: 'Nova',
      mediaDuration: '3:00',
      createdAt: new Date('2026-09-01'),
      composerFullName: 'Ana',
      instrumentName: undefined,
      epochName: 'Modernismo',
    });
  });

  it('as duas leituras respeitam o cache', async () => {
    cache.get.mockResolvedValue({ composers: [], works: [] });

    await service.getDiscoveries();
    await service.getRecentAdditions();

    expect(prisma.composer.findMany).not.toHaveBeenCalled();
  });
});
