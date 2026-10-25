import * as cheerio from 'cheerio';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Job, Queue } from 'bullmq';
import { AppCacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExternalPageFetcher } from '../../scrapers/imslp/external-page.fetcher';
import { ImslpScoresService, imslpScoresJobId } from './imslp-scores.service';

const WORK = '68600fb6df23f271f94bb803';
const PAGE = cheerio.load(
  readFileSync(
    join(__dirname, '../../scrapers/imslp/__fixtures__/nocturnes-op9.html'),
    'utf-8',
  ),
);

/** Redis de mentira, com `SET NX PX`, `INCR` e `DEL` de verdade. */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    set: jest.fn(async (key: string, value: string, ..._rest: unknown[]) => {
      if (store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    del: jest.fn(async (...keys: string[]) => {
      keys.forEach((k) => store.delete(k));
      return keys.length;
    }),
    incr: jest.fn(async (key: string) => {
      const next = Number(store.get(key) ?? 0) + 1;
      store.set(key, String(next));
      return next;
    }),
    pexpire: jest.fn(async () => 1),
  };
}

describe('ImslpScoresService', () => {
  let prisma: {
    workScore: { count: jest.Mock; createMany: jest.Mock };
    work: { findUnique: jest.Mock };
  };
  let fetcher: { load: jest.Mock };
  let cache: { get: jest.Mock; set: jest.Mock; invalidateMany: jest.Mock };
  let redis: ReturnType<typeof fakeRedis>;
  let queue: {
    add: jest.Mock;
    getJob: jest.Mock;
    getWaitingCount: jest.Mock;
    client: Promise<unknown>;
  };
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
      invalidateMany: jest.fn().mockResolvedValue(undefined),
    };
    redis = fakeRedis();
    queue = {
      add: jest.fn().mockResolvedValue({}),
      getJob: jest.fn().mockResolvedValue(undefined),
      getWaitingCount: jest.fn().mockResolvedValue(0),
      client: Promise.resolve(redis),
    };
    service = new ImslpScoresService(
      prisma as unknown as PrismaService,
      fetcher as unknown as ExternalPageFetcher,
      cache as unknown as AppCacheService,
      queue as unknown as Queue,
    );
  });

  // O BullMQ recusa `:` no jobId ("Custom Id cannot contain :"). Com a fila
  // simulada dos outros testes isso passava despercebido: o jobId era
  // `imslp-scores:<id>`, toda leitura lançava e nenhuma partitura era buscada.
  it('o jobId passa na validação de verdade do BullMQ', () => {
    const queueLike = { opts: {}, toKey: (k: string) => k, keys: {} };
    const job = new Job(
      queueLike as never,
      'imslp.work.scores',
      {},
      { jobId: imslpScoresJobId(WORK) },
    );

    // `validateOptions` é protegido, mas é o que o `Queue.add` chama.
    const validate = (
      job as unknown as { validateOptions(data: object): void }
    ).validateOptions.bind(job);

    expect(() => validate({})).not.toThrow();
    expect(imslpScoresJobId(WORK)).not.toContain(':');
  });

  describe('pedir (a rota pública)', () => {
    it('obra sem partitura: enfileira com id fixo e responde na hora', async () => {
      await expect(service.request(WORK)).resolves.toBe('pending');

      expect(queue.add).toHaveBeenCalledWith(
        'imslp.work.scores',
        expect.objectContaining({ payload: { workId: WORK } }),
        expect.objectContaining({
          jobId: imslpScoresJobId(WORK),
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        }),
      );
      // A requisição não lê o IMSLP: quem lê é o worker.
      expect(fetcher.load).not.toHaveBeenCalled();
    });

    it('obra que já tem partitura não enfileira', async () => {
      prisma.workScore.count.mockResolvedValue(5);

      await expect(service.request(WORK)).resolves.toBe('stored');
      expect(queue.add).not.toHaveBeenCalled();
    });

    // Sem a marca, a obra sem arquivo no IMSLP seria buscada a cada visita.
    it('obra lida há menos de um dia não enfileira de novo', async () => {
      cache.get.mockResolvedValue('done');
      await expect(service.request(WORK)).resolves.toBe('none');

      // A marca antiga (`true`, de antes da fila) vale igual.
      cache.get.mockResolvedValue(true);
      await expect(service.request(WORK)).resolves.toBe('none');

      cache.get.mockResolvedValue('failed');
      await expect(service.request(WORK)).resolves.toBe('unavailable');

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('robô não enfileira', async () => {
      await expect(service.request(WORK, { robot: true })).resolves.toBe(
        'unavailable',
      );
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('disjuntor aberto não enfileira', async () => {
      redis.store.set('imslp-scores:breaker:open', '1');

      await expect(service.request(WORK)).resolves.toBe('unavailable');
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('fila cheia não enfileira', async () => {
      queue.getWaitingCount.mockResolvedValue(300);

      await expect(service.request(WORK)).resolves.toBe('unavailable');
      expect(queue.add).not.toHaveBeenCalled();
    });

    // Redis ou fila fora não podem derrubar a página da obra.
    it('falha da fila não lança', async () => {
      queue.add.mockRejectedValue(new Error('redis fora'));

      await expect(service.request(WORK)).resolves.toBe('unavailable');
    });

    it('id inválido não chega ao banco nem à fila', async () => {
      await expect(service.request('abc')).resolves.toBe('none');
      expect(prisma.workScore.count).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('situação (o que a tela pergunta)', () => {
    it('com job na fila, está buscando; sem job nem marca, indisponível', async () => {
      queue.getJob.mockResolvedValue({ id: imslpScoresJobId(WORK) });
      await expect(service.status(WORK)).resolves.toBe('pending');

      queue.getJob.mockResolvedValue(undefined);
      await expect(service.status(WORK)).resolves.toBe('unavailable');

      prisma.workScore.count.mockResolvedValue(3);
      await expect(service.status(WORK)).resolves.toBe('stored');
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('raspar (o worker)', () => {
    it('lê o IMSLP, grava tudo, marca o dia e solta a trava', async () => {
      const stored = await service.scrape(WORK);

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
        'done',
        24 * 60 * 60 * 1000,
      );
      expect(redis.store.has(`imslp-scores:lock:${WORK}`)).toBe(false);
      // A obra e o compositor mostram as partituras novas já na próxima página.
      expect(cache.invalidateMany).toHaveBeenCalledWith(['works', 'composers']);
    });

    it('com a trava tomada (o admin relendo), não raspa', async () => {
      redis.store.set(`imslp-scores:lock:${WORK}`, '1');

      await expect(service.scrape(WORK)).resolves.toBe(0);
      expect(fetcher.load).not.toHaveBeenCalled();
    });

    it('obra que ganhou partitura enquanto esperava não é raspada', async () => {
      prisma.workScore.count.mockResolvedValue(2);

      await expect(service.scrape(WORK)).resolves.toBe(0);
      expect(fetcher.load).not.toHaveBeenCalled();
    });

    it('falha do IMSLP marca por uma hora e conta para o disjuntor', async () => {
      fetcher.load.mockRejectedValue(new Error('502'));

      await expect(service.scrape(WORK)).resolves.toBe(0);
      expect(cache.set).toHaveBeenCalledWith(
        `imslp-scores:tried:${WORK}`,
        'failed',
        60 * 60 * 1000,
      );
      expect(redis.store.get('imslp-scores:breaker:failures')).toBe('1');
    });

    it('cinco falhas seguidas abrem o disjuntor; um sucesso zera a conta', async () => {
      fetcher.load.mockRejectedValue(new Error('502'));
      for (let i = 0; i < 5; i++) await service.scrape(WORK);

      expect(redis.store.has('imslp-scores:breaker:open')).toBe(true);

      // Aberto: nem tenta.
      fetcher.load.mockClear();
      await service.scrape(WORK);
      expect(fetcher.load).not.toHaveBeenCalled();

      redis.store.delete('imslp-scores:breaker:open');
      redis.store.set('imslp-scores:breaker:failures', '3');
      fetcher.load.mockResolvedValue({ $: PAGE });
      await service.scrape(WORK);
      expect(redis.store.has('imslp-scores:breaker:failures')).toBe(false);
    });

    it('obra sem página no IMSLP é marcada e não busca nada', async () => {
      prisma.work.findUnique.mockResolvedValue({ imslpPermlink: '' });

      await expect(service.scrape(WORK)).resolves.toBe(0);
      expect(fetcher.load).not.toHaveBeenCalled();
      expect(cache.set).toHaveBeenCalledWith(
        `imslp-scores:tried:${WORK}`,
        'done',
        24 * 60 * 60 * 1000,
      );
    });
  });
});
