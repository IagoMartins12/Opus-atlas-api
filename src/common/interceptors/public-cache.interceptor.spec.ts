import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { PublicCacheInterceptor } from './public-cache.interceptor';
import { PublicCacheOptions } from '../decorators/public-cache.decorator';

describe('PublicCacheInterceptor', () => {
  const run = async (
    options: PublicCacheOptions | undefined,
    request: { method?: string } = {},
    response: { statusCode?: number; headersSent?: boolean } = {},
  ) => {
    const headers = new Map<string, string>();
    const res = {
      statusCode: response.statusCode ?? 200,
      headersSent: response.headersSent ?? false,
      setHeader: (key: string, value: string) => headers.set(key, value),
    };

    const context = {
      getType: () => 'http',
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => ({ method: request.method ?? 'GET' }),
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;

    const reflector = {
      getAllAndOverride: () => options,
    } as unknown as Reflector;

    const next: CallHandler = { handle: () => of({ ok: true }) };

    await firstValueFrom(
      new PublicCacheInterceptor(reflector).intercept(context, next),
    );

    return headers;
  };

  it('anota s-maxage e stale-while-revalidate na rota marcada', async () => {
    const headers = await run({
      maxAgeSeconds: 300,
      staleWhileRevalidateSeconds: 1800,
    });

    expect(headers.get('Cache-Control')).toBe(
      'public, max-age=0, s-maxage=300, stale-while-revalidate=1800',
    );
    expect(headers.get('Vary')).toBe('Accept-Encoding');
  });

  it('sem a anotação, não toca no cabeçalho', async () => {
    expect((await run(undefined)).size).toBe(0);
  });

  it('não marca mutação nem resposta de erro', async () => {
    expect((await run({ maxAgeSeconds: 60 }, { method: 'POST' })).size).toBe(0);
    expect(
      (await run({ maxAgeSeconds: 60 }, {}, { statusCode: 500 })).size,
    ).toBe(0);
  });

  it('sem janela declarada, a de revalidação iguala a de validade', async () => {
    const headers = await run({ maxAgeSeconds: 120 });

    expect(headers.get('Cache-Control')).toContain(
      'stale-while-revalidate=120',
    );
  });
});
