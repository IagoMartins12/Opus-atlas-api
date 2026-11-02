import * as cheerio from 'cheerio';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { PrismaService } from '../../prisma/prisma.service';
import { work } from './recheck-imslp-scores.job';

const PAGE = cheerio.load(
  readFileSync(
    join(__dirname, '../../scrapers/imslp/__fixtures__/nocturnes-op9.html'),
    'utf-8',
  ),
);

jest.mock('../../scrapers/imslp/external-page.fetcher', () => ({
  ExternalPageFetcher: jest.fn().mockImplementation(() => ({
    load: jest.fn().mockResolvedValue({ $: PAGE }),
  })),
}));
jest.mock('./job-types', () => ({
  ...jest.requireActual('./job-types'),
  sleep: () => Promise.resolve(),
}));

const WORK = '68600fb6df23f271f94bb803';

function setup(row: Record<string, unknown>, storedIds: string[]) {
  const prisma = {
    workScore: {
      aggregateRaw: jest
        .fn()
        .mockResolvedValue([{ _id: { $oid: WORK }, ...row }]),
      findMany: jest
        .fn()
        .mockResolvedValue(storedIds.map((sourceId) => ({ sourceId }))),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({}),
    },
    work: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({
        title: 'Nocturnes, Op.9',
        imslpPermlink:
          'https://imslp.org/wiki/Nocturnes,_Op.9_(Chopin,_Frédéric)',
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const run = (apply: boolean) =>
    work({
      prisma: prisma as unknown as PrismaService,
      apply,
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      args: {},
      progress: jest.fn(),
      shouldStop: () => false,
    });
  return { prisma, run };
}

describe('conferir as partituras do IMSLP', () => {
  it('obra com arquivo faltando ganha os que faltam e marca a releitura', async () => {
    const { prisma, run } = setup(
      {
        stored: 1,
        totals: JSON.stringify({ scores: 31, arrangements: 86 }),
        downloads: 10,
        dirty: false,
      },
      ['86550'],
    );

    const outcome = await run(true);

    expect(outcome?.summary).toMatchObject({ lidas: 1, comArquivoFaltando: 1 });
    expect(prisma.workScore.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.workScore.create.mock.calls.length).toBeGreaterThan(30);
    expect(prisma.work.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { editionsCheckedAt: expect.any(Date) },
      }),
    );
  });

  it('obra em ordem não é relida; simulação não grava', async () => {
    const ok = setup(
      {
        stored: 3,
        totals: JSON.stringify({ scores: 3 }),
        downloads: 1,
        dirty: false,
      },
      [],
    );
    await expect(ok.run(true)).resolves.toMatchObject({
      summary: { lidas: 0 },
    });

    const sim = setup(
      {
        stored: 1,
        totals: JSON.stringify({ scores: 9 }),
        downloads: 1,
        dirty: true,
      },
      ['86550'],
    );
    await sim.run(false);
    expect(sim.prisma.workScore.create).not.toHaveBeenCalled();
    expect(sim.prisma.workScore.updateMany).not.toHaveBeenCalled();
  });

  // Um "McGraw" de verdade parece linha colada: lida com o leitor novo, para.
  it('ficha suja já relida com o leitor novo não volta', async () => {
    const { prisma, run } = setup(
      {
        stored: 2,
        totals: JSON.stringify({ scores: 2 }),
        downloads: 1,
        dirty: true,
      },
      [],
    );
    prisma.work.findMany.mockResolvedValue([{ id: WORK }]);

    await expect(run(true)).resolves.toMatchObject({ summary: { lidas: 0 } });
  });
});
