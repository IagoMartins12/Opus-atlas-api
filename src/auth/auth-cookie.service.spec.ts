import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Request, Response } from 'express';
import {
  ACCESS_TOKEN_COOKIE,
  SESSION_HINT_COOKIE,
  AuthCookieService,
  OAUTH_STATE_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from './auth-cookie.service';

const session = {
  accessToken: 'acesso',
  refreshToken: 'renovacao',
  expiresIn: 900,
  user: {
    id: 'u1',
    email: 'a@x.com',
    role: 0,
    isTeacher: false,
    isStudent: false,
  },
};

describe('AuthCookieService', () => {
  let service: AuthCookieService;
  let config: Record<string, unknown>;
  let response: { cookie: jest.Mock; clearCookie: jest.Mock };

  const build = async (overrides: Record<string, unknown> = {}) => {
    config = { 'app.nodeEnv': 'development', ...overrides };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthCookieService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
      ],
    }).compile();

    service = module.get(AuthCookieService);
  };

  beforeEach(async () => {
    response = { cookie: jest.fn(), clearCookie: jest.fn() };
    await build();
  });

  const res = () => response as unknown as Response;
  const optionsOf = (name: string) =>
    (response.cookie.mock.calls as unknown[][]).find(
      ([cookie]) => cookie === name,
    )?.[2] as Record<string, unknown>;

  describe('applySession', () => {
    // O de acesso vai para o site todo: é o que deixa o servidor do Next
    // saber quem está logado. O de refresh só acompanha a autenticação.
    it('grava o acesso para o site todo e o refresh só nas rotas de autenticação', () => {
      service.applySession(res(), session);

      expect(response.cookie).toHaveBeenCalledWith(
        ACCESS_TOKEN_COOKIE,
        'acesso',
        expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
      );
      expect(response.cookie).toHaveBeenCalledWith(
        REFRESH_TOKEN_COOKIE,
        'renovacao',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          path: '/api/auth',
        }),
      );
    });

    it('o cookie de acesso vive o mesmo que o token; o de refresh, sete dias', () => {
      service.applySession(res(), session);

      expect(optionsOf(ACCESS_TOKEN_COOKIE).maxAge).toBe(900_000);
      expect(optionsOf(REFRESH_TOKEN_COOKIE).maxAge).toBe(604_800_000);
      // O marcador vive o mesmo que o refresh: é ele que diz ao middleware do
      // front que ainda há o que renovar depois de o acesso vencer.
      expect(optionsOf(SESSION_HINT_COOKIE).maxAge).toBe(604_800_000);
      expect(optionsOf(SESSION_HINT_COOKIE).httpOnly).toBe(false);
    });

    it('fora de produção o corpo leva os tokens; em produção, não', async () => {
      expect(service.applySession(res(), session)).toEqual(session);

      await build({ 'app.nodeEnv': 'production' });

      expect(service.applySession(res(), session)).toEqual({
        expiresIn: 900,
        user: session.user,
      });
    });

    it('não marca secure em desenvolvimento, senão o cookie nunca seria gravado sem HTTPS', async () => {
      service.applySession(res(), session);
      expect(optionsOf(ACCESS_TOKEN_COOKIE).secure).toBe(false);

      response.cookie.mockClear();
      await build({ 'app.nodeEnv': 'production' });
      service.applySession(res(), session);

      expect(optionsOf(ACCESS_TOKEN_COOKIE).secure).toBe(true);
      expect(optionsOf(REFRESH_TOKEN_COOKIE).secure).toBe(true);
    });

    // É o que faz a mesma sessão valer nas 4 zonas do front sem novo login.
    it('domínio raiz nos dois cookies quando configurado; nenhum em localhost', async () => {
      service.applySession(res(), session);
      expect(optionsOf(ACCESS_TOKEN_COOKIE)).not.toHaveProperty('domain');

      response.cookie.mockClear();
      await build({ 'auth.cookieDomain': '.opusatlas.com.br' });
      service.applySession(res(), session);

      expect(optionsOf(ACCESS_TOKEN_COOKIE).domain).toBe('.opusatlas.com.br');
      expect(optionsOf(REFRESH_TOKEN_COOKIE).domain).toBe('.opusatlas.com.br');
    });
  });

  describe('clearSession', () => {
    it('apaga os dois com os mesmos atributos da emissão', () => {
      service.clearSession(res());

      expect(response.clearCookie).toHaveBeenCalledWith(
        ACCESS_TOKEN_COOKIE,
        expect.objectContaining({ httpOnly: true, path: '/' }),
      );
      expect(response.clearCookie).toHaveBeenCalledWith(
        REFRESH_TOKEN_COOKIE,
        expect.objectContaining({ httpOnly: true, path: '/api/auth' }),
      );
    });
  });

  describe('extractRefreshToken', () => {
    const makeRequest = (cookies?: Record<string, string>) =>
      ({ cookies }) as unknown as Request;

    it('lê o token do cookie', () => {
      expect(
        service.extractRefreshToken(
          makeRequest({ [REFRESH_TOKEN_COOKIE]: 'do-cookie' }),
        ),
      ).toBe('do-cookie');
    });

    it('dá precedência ao cookie sobre o corpo', () => {
      expect(
        service.extractRefreshToken(
          makeRequest({ [REFRESH_TOKEN_COOKIE]: 'do-cookie' }),
          'do-body',
        ),
      ).toBe('do-cookie');
    });

    it('cai para o corpo quando não há cookie', () => {
      expect(service.extractRefreshToken(makeRequest(), 'do-body')).toBe(
        'do-body',
      );
    });

    it('devolve undefined quando não há nem cookie nem corpo', () => {
      expect(service.extractRefreshToken(makeRequest())).toBeUndefined();
    });
  });

  describe('estado do login com Google', () => {
    it('grava por dez minutos, só nas rotas do Google; lê e apaga', () => {
      service.setOAuthState(res(), 'estado');

      expect(response.cookie).toHaveBeenCalledWith(
        OAUTH_STATE_COOKIE,
        'estado',
        expect.objectContaining({
          httpOnly: true,
          path: '/api/auth/google',
          maxAge: 600_000,
        }),
      );
      expect(
        service.readOAuthState({
          cookies: { [OAUTH_STATE_COOKIE]: 'estado' },
        } as unknown as Request),
      ).toBe('estado');
      expect(service.readOAuthState({} as Request)).toBeUndefined();

      service.clearOAuthState(res());
      expect(response.clearCookie).toHaveBeenCalledWith(
        OAUTH_STATE_COOKIE,
        expect.objectContaining({ path: '/api/auth/google' }),
      );
    });
  });

  describe('shouldReturnTokenInBody', () => {
    it('devolve o token no corpo fora de produção, para testar pelo Swagger', () => {
      expect(service.shouldReturnTokenInBody()).toBe(true);
    });

    it('nunca devolve o token no corpo em produção', async () => {
      await build({ 'app.nodeEnv': 'production' });

      expect(service.shouldReturnTokenInBody()).toBe(false);
    });
  });
});
