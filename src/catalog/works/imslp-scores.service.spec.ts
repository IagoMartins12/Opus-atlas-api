import * as cheerio from 'cheerio';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AppCacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExternalPageFetcher } from '../../scrapers/imslp/external-page.fetcher';
import { ImslpScoresService } from './imslp-scores.service';

const WORK = '68600fb6df23f271f94bb803';
const PAGE = cheerio.load(
  readFileSync(
    join(__dirname, '../../scrapers/imslp/__fixtures__/nocturnes-op9.html'),
    'utf-8',
  ),
);

describe('ImslpScoresService', () => {
  let prisma: {
    workScore: { count: jest.Mock; createMany: jest.Mock };
    work: { findUnique: jest.Mock };
  };
  let fetcher: { load: jest.Mock };
  let cache: { get: jest.Mock; set: jest.Mock };
  let service: ImslpScoresService;

  beforeEach(() => {
    prisma = {
      workScore: {
        count: jest.fn().mockResolvedValue(0),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      work: {
        findUnique: jest.fn().mockResolvedValue({
          imslpPermlink:
            'https://imslp.org/wiki/Nocturnes,_Op.9_(Chopin,_Frédéric)',
        }),
      },
    };
    fetcher = { load: jest.fn().mockResolvedValue({ $: PAGE }) };
    cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };
    service = new ImslpScoresService(
      prisma as unknown as PrismaService,
      fetcher as unknown as ExternalPageFetcher,
      cache as unknown as AppCacheService,
    );
  });

  it('obra sem partitura: lê o IMSLP uma vez e grava tudo', async () => {
    const stored = await service.ensure(WORK);

    // A fixture tem a aba de partituras inteira e 3 grupos de arranjos.
    expect(stored).toBeGreaterThan(31);
    const [{ data }] = prisma.workScore.createMany.mock.calls[0] as [
      { data: Array<Record<string, unknown>> },
    ];
    expect(data[0]).toMatchObject({
      workId: WORK,
      sourceId: '86550',
      source: 'IMSLP',
      type: 'SCORES',
    });
    expect(cache.set).toHaveBeenCalledWith(
      `imslp-scores:tried:${WORK}`,
      true,
      24 * 60 * 60 * 1000,
    );
  });

  it('obra que já tem partitura não é raspada', async () => {
    prisma.workScore.count.mockResolvedValue(5);

    await service.ensure(WORK);

    expect(fetcher.load).not.toHaveBeenCalled();
  });

  // Sem a marca, a obra sem arquivo no IMSLP seria buscada a cada visita.
  it('obra tentada há menos de um dia não é raspada de novo', async () => {
    cache.get.mockResolvedValue(true);

    await service.ensure(WORK);

    expect(fetcher.load).not.toHaveBeenCalled();
  });

  it('duas visitas ao mesmo tempo esperam a mesma raspagem', async () => {
    await Promise.all([service.ensure(WORK), service.ensure(WORK)]);

    expect(fetcher.load).toHaveBeenCalledTimes(1);
  });

  // Falha do IMSLP não pode derrubar a página da obra.
  it('falha do IMSLP não lança, e tenta de novo mais cedo', async () => {
    fetcher.load.mockRejectedValue(new Error('502'));

    await expect(service.ensure(WORK)).resolves.toBe(0);
    expect(cache.set).toHaveBeenCalledWith(
      `imslp-scores:tried:${WORK}`,
      true,
      60 * 60 * 1000,
    );
  });

  it('obra sem página no IMSLP é marcada e não busca nada', async () => {
    prisma.work.findUnique.mockResolvedValue({ imslpPermlink: '' });

    await expect(service.ensure(WORK)).resolves.toBe(0);
    expect(fetcher.load).not.toHaveBeenCalled();
  });

  it('id inválido não chega ao banco', async () => {
    await expect(service.ensure('abc')).resolves.toBe(0);
    expect(prisma.workScore.count).not.toHaveBeenCalled();
  });
});
