import { ConfigService } from '@nestjs/config';
import {
  REVALIDATE_DEBOUNCE_MS,
  RevalidationService,
  tagOf,
} from './revalidation.service';

const config = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const ON = {
  'revalidation.url': 'https://opusatlas.com.br/api/revalidate',
  'revalidation.secret': 'x'.repeat(32),
};

describe('RevalidationService', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => jest.useRealTimers());

  it('namespace vira tag do Next', () => {
    expect(tagOf('blog:articles')).toBe('blog-articles');
    expect(tagOf('works')).toBe('works');
  });

  // Uma escrita no catálogo limpa quatro domínios: o front recebe um aviso só.
  it('junta os avisos próximos num POST só, assinado', async () => {
    const service = new RevalidationService(config(ON));

    service.onCacheInvalidated({ namespaces: ['works', 'composers'] });
    service.onCacheInvalidated({ namespaces: ['works', 'blog:articles'] });
    expect(fetchMock).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(REVALIDATE_DEBOUNCE_MS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ON['revalidation.url']);
    expect(
      (init.headers as Record<string, string>)['x-revalidate-secret'],
    ).toBe(ON['revalidation.secret']);
    expect(JSON.parse(init.body as string)).toEqual({
      tags: ['blog-articles', 'composers', 'works'],
      source: 'opus-atlas-api',
    });
  });

  it('sem URL, fica desligado', async () => {
    const service = new RevalidationService(config({}));

    service.onCacheInvalidated({ namespaces: ['works'] });
    await jest.advanceTimersByTimeAsync(REVALIDATE_DEBOUNCE_MS);

    expect(service.enabled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A escrita que causou o aviso nunca paga pela queda do front.
  it('falha do front vira log, não erro', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const service = new RevalidationService(config(ON));

    service.onCacheInvalidated({ namespaces: ['works'] });

    await expect(service.flush()).resolves.toBeUndefined();
  });

  it('ao desligar, manda o que ficou na fila', async () => {
    const service = new RevalidationService(config(ON));

    service.onCacheInvalidated({ namespaces: ['teachers'] });
    await service.onModuleDestroy();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
