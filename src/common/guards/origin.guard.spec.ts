import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { OriginGuard } from './origin.guard';

const ALLOWED = ['https://opusatlas.com', 'https://admin.opusatlas.com'];

interface RequestShape {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
}

const makeContext = (request: RequestShape): ExecutionContext =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  }) as unknown as ExecutionContext;

describe('OriginGuard', () => {
  let guard: OriginGuard;

  beforeEach(() => {
    const config = {
      get: <T>(_key: string, _fallback?: T) => ALLOWED as unknown as T,
    } as ConfigService;

    guard = new OriginGuard(config, new Reflector());
  });

  const run = (request: Partial<RequestShape>) =>
    guard.canActivate(
      makeContext({
        method: 'POST',
        path: '/api/auth/refresh',
        headers: {},
        ...request,
      }),
    );

  it('libera métodos de leitura sem checar origem', () => {
    expect(run({ method: 'GET', headers: { cookie: 'a=1' } })).toBe(true);
  });

  it('libera mutação vinda de origem permitida', () => {
    expect(
      run({ headers: { origin: 'https://opusatlas.com', cookie: 'a=1' } }),
    ).toBe(true);
  });

  it('bloqueia mutação vinda de origem não permitida', () => {
    expect(() => run({ headers: { origin: 'https://evil.com' } })).toThrow(
      ForbiddenException,
    );
  });

  // O ataque concreto: um site externo faz o navegador da vítima disparar a
  // requisição, e o cookie de refresh viaja junto automaticamente.
  it('bloqueia mutação com cookie e sem Origin', () => {
    expect(() => run({ headers: { cookie: 'opus_refresh_token=x' } })).toThrow(
      ForbiddenException,
    );
  });

  it('libera mutação sem cookie e sem Origin (curl, chamada interna)', () => {
    expect(run({ headers: {} })).toBe(true);
  });

  // Bearer não é anexado automaticamente pelo navegador, então não há CSRF.
  it('libera requisição autenticada por Bearer mesmo de outra origem', () => {
    expect(
      run({
        headers: { authorization: 'Bearer abc', origin: 'https://evil.com' },
      }),
    ).toBe(true);
  });

  it('cai para o Referer quando não há Origin', () => {
    expect(
      run({
        headers: {
          referer: 'https://admin.opusatlas.com/usuarios',
          cookie: 'a=1',
        },
      }),
    ).toBe(true);
  });

  it('bloqueia Referer de origem não permitida', () => {
    expect(() =>
      run({ headers: { referer: 'https://evil.com/x', cookie: 'a=1' } }),
    ).toThrow(ForbiddenException);
  });

  it('isenta o webhook do Stripe, que não vem de navegador', () => {
    expect(
      run({ path: '/api/webhook/stripe', headers: { cookie: 'a=1' } }),
    ).toBe(true);
  });

  it('isenta as rotas de cron e de métricas', () => {
    expect(
      run({ path: '/api/cron/subscriptions', headers: { cookie: 'a=1' } }),
    ).toBe(true);
    expect(run({ path: '/api/metrics', headers: { cookie: 'a=1' } })).toBe(
      true,
    );
  });

  it('aplica a checagem em PUT, PATCH e DELETE', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      expect(() =>
        run({ method, headers: { origin: 'https://evil.com' } }),
      ).toThrow(ForbiddenException);
    }
  });
});
