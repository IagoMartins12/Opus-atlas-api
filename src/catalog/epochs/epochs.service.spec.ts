import { Cache } from 'cache-manager';
import { PrismaService } from '../../prisma/prisma.service';
import { EpochsService } from './epochs.service';

const composer = (
  id: string,
  epochId: string,
  epochName: string,
  birthDate: string | null,
) => ({
  id,
  name: id,
  fullName: `Nome ${id}`,
  portraitUrl: null,
  birthDate,
  deathDate: '1850-01-01',
  bio: null,
  epoch: { id: epochId, name: epochName },
});

describe('EpochsService', () => {
  let prisma: {
    epoch: { findMany: jest.Mock };
    composer: { findMany: jest.Mock };
  };
  let cache: { get: jest.Mock; set: jest.Mock };
  let service: EpochsService;

  beforeEach(() => {
    prisma = {
      epoch: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'e1', name: 'Barroco' },
          { id: 'e0', name: 'Desconhecido' },
        ]),
      },
      composer: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            composer('bach', 'e1', 'Barroco', '1685-03-31'),
            composer('chopin', 'e2', 'Romântico', '1810'),
            composer('anon', 'e2', 'Romântico', 'data incerta'),
            composer('x', 'e9', 'Outra', null),
          ]),
      },
    };
    cache = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() };
    service = new EpochsService(
      prisma as unknown as PrismaService,
      cache as unknown as Cache,
    );
  });

  it('lista sem a época "Desconhecido"', async () => {
    await expect(service.findAll()).resolves.toEqual([
      { id: 'e1', name: 'Barroco' },
    ]);
  });

  it('agrupa em ordem cronológica e ignora época fora da lista', async () => {
    const groups = await service.getComposersByEpoch();

    expect(groups.map((g) => g.epochName)).toEqual(['Barroco', 'Romântico']);
    expect(groups[1]).toMatchObject({ epochId: 'e2' });
    expect(groups[1].composers.map((c) => c.id)).toEqual(['chopin', 'anon']);
  });

  it('no máximo 12 por época', async () => {
    prisma.composer.findMany.mockResolvedValue(
      Array.from({ length: 15 }, (_, i) =>
        composer(`c${i}`, 'e1', 'Barroco', null),
      ),
    );

    const [barroco] = await service.getComposersByEpoch();

    expect(barroco.composers).toHaveLength(12);
  });

  it('linha do tempo extrai o ano, e dá null quando não há ano', async () => {
    const timeline = await service.getTimeline();

    expect(timeline.map((c) => [c.id, c.birthYear, c.deathYear])).toEqual([
      ['bach', 1685, 1850],
      ['chopin', 1810, 1850],
      ['anon', null, 1850],
      ['x', null, 1850],
    ]);
  });

  // Nome com ponto ou parêntese não pode virar expressão regular.
  it('a curadoria procura os nomes escapados', async () => {
    await service.getTimeline();

    const [{ where }] = prisma.composer.findMany.mock.calls[0];
    const firstName = where.AND[1].OR[0].OR[0].fullName.equals;
    expect(typeof firstName).toBe('string');
  });

  it('as três leituras respeitam o cache', async () => {
    cache.get.mockResolvedValue([{ id: 'cache' }]);

    await expect(service.findAll()).resolves.toEqual([{ id: 'cache' }]);
    await expect(service.getComposersByEpoch()).resolves.toEqual([
      { id: 'cache' },
    ]);
    await expect(service.getTimeline()).resolves.toEqual([{ id: 'cache' }]);
    expect(prisma.composer.findMany).not.toHaveBeenCalled();
  });
});
