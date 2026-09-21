// `@nestjs/jwt@12` é ESM puro e o ts-jest não o lê; o controller só precisa
// do tipo, via AuthService — mesma saída do `auth.service.spec.ts`.
jest.mock('@nestjs/jwt', () => ({ JwtService: class JwtService {} }));

import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { authCookieNames, AuthCookieService } from './auth-cookie.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import {
  accessTokenFromCookie,
  extractAccessToken,
  JwtAccessStrategy,
} from './strategies/jwt-access.strategy';

const session = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresIn: 900,
  user: { id: 'u1' },
} as never;
const body = { expiresIn: 900, user: { id: 'u1' } };

describe('AuthController', () => {
  let auth: Record<string, jest.Mock>;
  let cookie: {
    applySession: jest.Mock;
    extractRefreshToken: jest.Mock;
    clearSession: jest.Mock;
  };
  let controller: AuthController;
  const response = {} as Response;
  const request = (headers: Record<string, string> = {}, ip?: string) =>
    ({ headers, ip }) as unknown as Request;

  beforeEach(() => {
    auth = Object.fromEntries(
      [
        'register',
        'login',
        'refresh',
        'logout',
        'checkEmailStatus',
        'confirmAccount',
        'forgotPassword',
        'resetPassword',
        'confirmEmailChange',
        'resendAccountConfirmation',
      ].map((method) => [method, jest.fn().mockResolvedValue(session)]),
    );
    cookie = {
      applySession: jest.fn().mockReturnValue(body),
      extractRefreshToken: jest.fn().mockReturnValue('do-cookie'),
      clearSession: jest.fn(),
    };
    controller = new AuthController(
      auth as unknown as AuthService,
      cookie as unknown as AuthCookieService,
    );
  });

  // O corpo é o que o serviço de cookies decidiu: em produção, sem tokens.
  it('cadastro e login gravam a sessão nos cookies e devolvem o corpo decidido por eles', async () => {
    await expect(controller.login({} as never, response)).resolves.toBe(body);
    await expect(controller.register({} as never, response)).resolves.toBe(
      body,
    );

    expect(cookie.applySession).toHaveBeenCalledTimes(2);
    expect(cookie.applySession).toHaveBeenCalledWith(response, session);
  });

  it('refresh usa o token do cookie e regrava a sessão; sem token é 401', async () => {
    await expect(
      controller.refresh({} as never, request(), response),
    ).resolves.toBe(body);
    expect(auth.refresh).toHaveBeenCalledWith({ refreshToken: 'do-cookie' });

    cookie.extractRefreshToken.mockReturnValue(undefined);
    await expect(
      controller.refresh({} as never, request(), response),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('logout limpa os cookies sempre, e revoga quando há token', async () => {
    await controller.logout({} as never, request(), response);
    expect(cookie.clearSession).toHaveBeenCalledWith(response);
    expect(auth.logout).toHaveBeenCalledWith({ refreshToken: 'do-cookie' });

    cookie.extractRefreshToken.mockReturnValue(undefined);
    auth.logout.mockClear();
    await controller.logout({} as never, request(), response);
    expect(cookie.clearSession).toHaveBeenCalledTimes(2);
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('reenvio da confirmação leva o IP real e o navegador', async () => {
    await controller.resendConfirmation(
      { email: 'a@x.com' },
      request({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1', 'user-agent': 'UA' }),
    );
    expect(auth.resendAccountConfirmation).toHaveBeenCalledWith(
      { email: 'a@x.com' },
      { ipAddress: '9.9.9.9', userAgent: 'UA' },
    );

    await controller.resendConfirmation({ email: 'a@x.com' }, request());
    expect(auth.resendAccountConfirmation).toHaveBeenLastCalledWith(
      { email: 'a@x.com' },
      { ipAddress: 'unknown', userAgent: 'unknown' },
    );
  });

  it('status do e-mail exige o e-mail', async () => {
    await expect(controller.checkEmailStatus('')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await controller.checkEmailStatus('a@x.com');
    expect(auth.checkEmailStatus).toHaveBeenCalledWith('a@x.com');
  });

  it('confirmações por token repassam ao serviço', async () => {
    await controller.confirmAccount('t1');
    await controller.confirmEmailChange('t2');

    expect(auth.confirmAccount).toHaveBeenCalledWith('t1');
    expect(auth.confirmEmailChange).toHaveBeenCalledWith('t2');
  });

  it('recuperação de senha leva o IP real e o navegador', async () => {
    await controller.forgotPassword(
      {} as never,
      request({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1', 'user-agent': 'UA' }),
    );
    expect(auth.forgotPassword).toHaveBeenCalledWith(
      {},
      { ipAddress: '9.9.9.9', userAgent: 'UA' },
    );

    await controller.resetPassword({} as never, request({}, '2.2.2.2'));
    expect(auth.resetPassword).toHaveBeenCalledWith(
      {},
      { ipAddress: '2.2.2.2' },
    );

    await controller.forgotPassword({} as never, request());
    expect(auth.forgotPassword).toHaveBeenLastCalledWith(
      {},
      { ipAddress: 'unknown', userAgent: 'unknown' },
    );
  });
});

function contextWith(user?: { role: number }): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guardWith = (roles: string[] | undefined) =>
    new RolesGuard({
      getAllAndOverride: jest.fn().mockReturnValue(roles),
    } as unknown as Reflector);

  it('rota sem papel exigido passa', () => {
    expect(guardWith(undefined).canActivate(contextWith())).toBe(true);
    expect(guardWith([]).canActivate(contextWith())).toBe(true);
  });

  it('papel igual ou maior passa; menor é 403', () => {
    expect(guardWith(['ADMIN']).canActivate(contextWith({ role: 1 }))).toBe(
      true,
    );
    expect(guardWith(['ADMIN']).canActivate(contextWith({ role: 2 }))).toBe(
      true,
    );
    expect(() =>
      guardWith(['SUPER_ADMIN']).canActivate(contextWith({ role: 1 })),
    ).toThrow(ForbiddenException);
  });

  it('com vários papéis vale o menor; papel desconhecido nunca é atingido', () => {
    expect(
      guardWith(['SUPER_ADMIN', 'ADMIN']).canActivate(contextWith({ role: 1 })),
    ).toBe(true);
    expect(() =>
      guardWith(['DONO']).canActivate(contextWith({ role: 2 })),
    ).toThrow(ForbiddenException);
  });

  it('sem usuário no pedido é 403', () => {
    expect(() => guardWith(['ADMIN']).canActivate(contextWith())).toThrow(
      'Usuário não autenticado',
    );
  });
});

describe('JwtAuthGuard', () => {
  it('rota @Public() passa sem token', () => {
    const guard = new JwtAuthGuard({
      getAllAndOverride: jest.fn().mockReturnValue(true),
    } as unknown as Reflector);

    expect(guard.canActivate(contextWith())).toBe(true);
  });

  it('rota protegida delega ao passport', () => {
    const guard = new JwtAuthGuard({
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector);
    const parent = jest
      .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate')
      .mockReturnValue(false);

    expect(guard.canActivate(contextWith())).toBe(false);
    expect(parent).toHaveBeenCalled();
    parent.mockRestore();
  });
});

describe('JwtAccessStrategy', () => {
  it('usa o segredo de acesso e devolve o payload como usuário', () => {
    const strategy = new JwtAccessStrategy({
      get: jest
        .fn()
        .mockReturnValue('segredo-de-acesso-com-mais-de-32-caracteres'),
    } as unknown as ConfigService);
    const payload = { sub: 'u1', role: 0 } as never;

    expect(strategy.validate(payload)).toBe(payload);
  });

  // Quem manda os dois — o servidor do Next repassando a sessão — escolheu o
  // cabeçalho; o navegador manda só o cookie.
  it('lê o token do cabeçalho primeiro e do cookie depois', () => {
    const req = (
      headers: Record<string, string>,
      cookies?: Record<string, string>,
    ) => ({ headers, cookies }) as unknown as Request;

    expect(
      extractAccessToken(
        req(
          { authorization: 'Bearer do-cabecalho' },
          { [authCookieNames().access]: 'do-cookie' },
        ),
      ),
    ).toBe('do-cabecalho');
    expect(
      extractAccessToken(req({}, { [authCookieNames().access]: 'do-cookie' })),
    ).toBe('do-cookie');
    expect(extractAccessToken(req({}))).toBeNull();
    expect(accessTokenFromCookie(undefined)).toBeNull();
    expect(
      accessTokenFromCookie(req({}, { [authCookieNames().access]: '' })),
    ).toBeNull();
  });
});
