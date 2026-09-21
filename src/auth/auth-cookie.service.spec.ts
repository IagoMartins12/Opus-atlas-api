import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Request, Response } from 'express';
import { authCookieNames, AuthCookieService } from './auth-cookie.service';

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
        authCookieNames().access,
        'acesso',
        expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
      );
      expect(response.cookie).toHaveBeenCalledWith(
        authCookieNames().refresh,
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

      expect(optionsOf(authCookieNames().access).maxAge).toBe(900_000);
      expect(optionsOf(authCookieNames().refresh).maxAge).toBe(604_800_000);
      // O marcador vive o mesmo que o refresh: é ele que diz ao middleware do
      // front que ainda há o que renovar depois de o acesso vencer.
      expect(optionsOf(authCookieNames().sessionHint).maxAge).toBe(604_800_000);
      expect(optionsOf(authCookieNames().sessionHint).httpOnly).toBe(false);
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
      expect(optionsOf(authCookieNames().access).secure).toBe(false);

      response.cookie.mockClear();
      await build({ 'app.nodeEnv': 'production' });
      service.applySession(res(), session);

      expect(optionsOf(authCookieNames().access).secure).toBe(true);
      expect(optionsOf(authCookieNames().refresh).secure).toBe(true);
    });

    it('marca secure em homologação, que tem HTTPS como produção', async () => {
      await build({ 'app.nodeEnv': 'staging' });
      service.applySession(res(), session);

      expect(optionsOf(authCookieNames().access).secure).toBe(true);
    });

    // É o que faz a mesma sessão valer nas 4 zonas do front sem novo login.
    it('domínio raiz nos dois cookies quando configurado; nenhum em localhost', async () => {
      service.applySession(res(), session);
      expect(optionsOf(authCookieNames().access)).not.toHaveProperty('domain');

      response.cookie.mockClear();
      await build({ 'auth.cookieDomain': '.opusatlas.com.br' });
      service.applySession(res(), session);

      expect(optionsOf(authCookieNames().access).domain).toBe(
        '.opusatlas.com.br',
      );
      expect(optionsOf(authCookieNames().refresh).domain).toBe(
        '.opusatlas.com.br',
      );
    });
  });

  describe('clearSession', () => {
    it('apaga os dois com os mesmos atributos da emissão', () => {
      service.clearSession(res());

      expect(response.clearCookie).toHaveBeenCalledWith(
        authCookieNames().access,
        expect.objectContaining({ httpOnly: true, path: '/' }),
      );
      expect(response.clearCookie).toHaveBeenCalledWith(
        authCookieNames().refresh,
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
          makeRequest({ [authCookieNames().refresh]: 'do-cookie' }),
        ),
      ).toBe('do-cookie');
    });

    it('dá precedência ao cookie sobre o corpo', () => {
      expect(
        service.extractRefreshToken(
          makeRequest({ [authCookieNames().refresh]: 'do-cookie' }),
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
        authCookieNames().oauthState,
        'estado',
        expect.objectContaining({
          httpOnly: true,
          path: '/api/auth/google',
          maxAge: 600_000,
        }),
      );
      expect(
        service.readOAuthState({
          cookies: { [authCookieNames().oauthState]: 'estado' },
        } as unknown as Request),
      ).toBe('estado');
      expect(service.readOAuthState({} as Request)).toBeUndefined();

      service.clearOAuthState(res());
      expect(response.clearCookie).toHaveBeenCalledWith(
        authCookieNames().oauthState,
        expect.objectContaining({ path: '/api/auth/google' }),
      );
    });
  });

  describe('shouldReturnTokenInBody', () => {
    it('devolve o token no corpo em desenvolvimento, para testar pelo Swagger', () => {
      expect(service.shouldReturnTokenInBody()).toBe(true);
    });

    it.each(['production', 'staging'])(
      'nunca devolve o token no corpo em %s',
      async (nodeEnv) => {
        await build({ 'app.nodeEnv': nodeEnv });

        expect(service.shouldReturnTokenInBody()).toBe(false);
      },
    );
  });
});

describe('authCookieNames', () => {
  const original = process.env.AUTH_COOKIE_PREFIX;

  afterEach(() => {
    if (original === undefined) delete process.env.AUTH_COOKIE_PREFIX;
    else process.env.AUTH_COOKIE_PREFIX = original;
  });

  it('usa os nomes de produção sem prefixo configurado', () => {
    delete process.env.AUTH_COOKIE_PREFIX;

    expect(authCookieNames()).toEqual({
      access: 'opus_access_token',
      refresh: 'opus_refresh_token',
      oauthState: 'opus_oauth_state',
      sessionHint: 'opus_session',
    });
  });

  /**
   * O motivo de ser função: o `ConfigModule` carrega o `.env.*` depois dos
   * imports. Um prefixo que chega ao `process.env` depois de o módulo ser
   * carregado — como este — tem de valer.
   */
  it('lê o prefixo na hora do uso, não no import', () => {
    process.env.AUTH_COOKIE_PREFIX = 'opus_hml';

    expect(authCookieNames().access).toBe('opus_hml_access_token');
    expect(authCookieNames().sessionHint).toBe('opus_hml_session');
  });

  it('trata prefixo vazio como ausente', () => {
    process.env.AUTH_COOKIE_PREFIX = '  ';

    expect(authCookieNames().access).toBe('opus_access_token');
  });
});
