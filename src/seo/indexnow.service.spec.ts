import { AppCacheService } from '../common/cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { IndexNowService, nextStart } from './indexnow.service';

describe('IndexNowService', () => {
  const ontem = new Date('2026-10-26T12:00:00Z');
  const agora = new Date('2026-10-27T12:00:00Z');
  let cache: { get: jest.Mock; set: jest.Mock };
  let prisma: Record<string, { findMany: jest.Mock }>;
  let fetchMock: jest.Mock;
  let service: IndexNowService;

  beforeEach(() => {
    process.env.INDEXNOW_KEY = 'chave123';
    process.env.FRONTEND_BASE_URL = 'https://opusatlas.com.br';
    cache = {
      get: jest.fn().mockResolvedValue(ontem.toISOString()),
      set: jest.fn(),
    };
    prisma = {
      work: {
        findMany: jest.fn().mockResolvedValue([{ id: 'w1', updatedAt: agora }]),
      },
      composer: {
        findMany: jest.fn().mockResolvedValue([{ id: 'c1', updatedAt: agora }]),
      },
      blogArticle: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ slug: 'como-estudar', updatedAt: agora }]),
      },
    };
    fetchMock = jest.fn().mockResolvedValue({ status: 200 });
    global.fetch = fetchMock as never;
    service = new IndexNowService(
      prisma as unknown as PrismaService,
      cache as unknown as AppCacheService,
    );
  });

  afterEach(() => {
    delete process.env.INDEXNOW_KEY;
    delete process.env.FRONTEND_BASE_URL;
  });

  it('avisa o que mudou, em português e inglês, com a chave do site', async () => {
    await expect(service.submitChanged(agora)).resolves.toEqual({
      enabled: true,
      urls: 5,
      refused: [],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      host: 'opusatlas.com.br',
      key: 'chave123',
      keyLocation: 'https://opusatlas.com.br/indexnow.txt',
      urlList: [
        'https://opusatlas.com.br/works/w1',
        'https://opusatlas.com.br/en/works/w1',
        'https://opusatlas.com.br/composer/c1',
        'https://opusatlas.com.br/en/composer/c1',
        'https://opusatlas.com.br/blog/como-estudar',
      ],
    });
    expect(cache.set).toHaveBeenCalledWith(
      'indexnow:last-run',
      agora.toISOString(),
      expect.any(Number),
    );
  });

  it('sem chave, ou fora do site público, não avisa nada', async () => {
    delete process.env.INDEXNOW_KEY;
    await expect(service.submitChanged(agora)).resolves.toMatchObject({
      enabled: false,
    });
    process.env.INDEXNOW_KEY = 'chave123';
    process.env.FRONTEND_BASE_URL = 'http://localhost:3000';
    await expect(service.submitChanged(agora)).resolves.toMatchObject({
      enabled: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a primeira rodada só marca o começo (o acervo inteiro é do sitemap)', async () => {
    cache.get.mockResolvedValue(undefined);
    await expect(service.submitChanged(agora)).resolves.toMatchObject({
      urls: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cache.set).toHaveBeenCalled();
  });

  it('recusado, a mesma janela volta na próxima rodada', async () => {
    fetchMock.mockResolvedValue({ status: 422 });
    await expect(service.submitChanged(agora)).resolves.toMatchObject({
      refused: [422],
    });
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('lista cortada no teto segue da última mudança enviada', () => {
    const meio = new Date('2026-10-27T00:00:00Z');
    expect(
      nextStart(agora, [
        [[{ updatedAt: meio }], 1],
        [[], 10],
      ]),
    ).toEqual(meio);
    expect(nextStart(agora, [[[{ updatedAt: meio }], 5]])).toEqual(agora);
  });
});
