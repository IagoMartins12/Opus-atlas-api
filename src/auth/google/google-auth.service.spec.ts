import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { GoogleAuthService, safeRedirectPath } from './google-auth.service';

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => mockClient),
  CodeChallengeMethod: { S256: 'S256' },
}));

const mockClient = {
  generateCodeVerifierAsync: jest.fn(),
  generateAuthUrl: jest.fn(),
  getToken: jest.fn(),
  verifyIdToken: jest.fn(),
};

const configured = {
  'auth.google.clientId': 'cid',
  'auth.google.clientSecret': 'segredo',
  'auth.google.redirectUri': 'http://api/api/auth/google/callback',
  'mediaSearch.frontendBaseUrl': 'http://front.test',
};

const build = (values: Record<string, string> = configured) =>
  new GoogleAuthService({
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService);

const decode = (cookie: string) =>
  JSON.parse(Buffer.from(cookie, 'base64url').toString('utf8')) as {
    state: string;
    codeVerifier: string;
    redirect: string;
  };

describe('GoogleAuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.generateCodeVerifierAsync.mockResolvedValue({
      codeVerifier: 'verificador',
      codeChallenge: 'desafio',
    });
    mockClient.generateAuthUrl.mockReturnValue('https://accounts.google/auth');
    mockClient.getToken.mockResolvedValue({ tokens: { id_token: 'idt' } });
    mockClient.verifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: 'g-1',
        email: 'ana@gmail.com',
        email_verified: true,
        given_name: 'Ana',
        family_name: 'Lima',
        picture: 'https://foto',
      }),
    });
  });

  it('só está configurado com as três variáveis', () => {
    expect(build().isConfigured()).toBe(true);
    expect(
      build({ ...configured, 'auth.google.redirectUri': '' }).isConfigured(),
    ).toBe(false);
  });

  it('sem configuração, começar o login é 503', async () => {
    await expect(build({}).start('/')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  describe('começar', () => {
    it('manda ao Google com PKCE e guarda estado, verificador e destino no cookie', async () => {
      const { url, cookie } = await build().start('/works?pagina=2');
      const pending = decode(cookie);

      expect(url).toBe('https://accounts.google/auth');
      expect(pending).toEqual({
        state: expect.any(String),
        codeVerifier: 'verificador',
        redirect: '/works?pagina=2',
      });
      expect(mockClient.generateAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: ['openid', 'email', 'profile'],
          state: pending.state,
          code_challenge: 'desafio',
          code_challenge_method: 'S256',
        }),
      );
      expect((OAuth2Client as unknown as jest.Mock).mock.calls[0][0]).toEqual({
        clientId: 'cid',
        clientSecret: 'segredo',
        redirectUri: 'http://api/api/auth/google/callback',
      });
    });

    // Sem a trava, `?redirect=https://site-falso` levaria a pessoa, recém-logada, para fora.
    it('destino que não é caminho do front vira a raiz', async () => {
      const { cookie } = await build().start('https://site-falso.com');

      expect(decode(cookie).redirect).toBe('/');
    });
  });

  describe('conferir a volta', () => {
    it('aceita o state do próprio cookie', async () => {
      const service = build();
      const { cookie } = await service.start('/a');
      const { state } = decode(cookie);

      expect(service.readPending(cookie, state)).toEqual({
        state,
        codeVerifier: 'verificador',
        redirect: '/a',
      });
    });

    // É o que impede o login CSRF: a volta tem de ter começado neste navegador.
    it('recusa state diferente, ausente ou cookie adulterado', async () => {
      const service = build();
      const { cookie } = await service.start('/a');
      const { state } = decode(cookie);

      expect(service.readPending(cookie, `${state.slice(1)}x`)).toBeNull();
      expect(service.readPending(cookie, 'curto')).toBeNull();
      expect(service.readPending(undefined, state)).toBeNull();
      expect(service.readPending(cookie, undefined)).toBeNull();
      expect(service.readPending('não-é-base64-json', state)).toBeNull();
      expect(
        service.readPending(
          Buffer.from(JSON.stringify({ state: 1 })).toString('base64url'),
          '1',
        ),
      ).toBeNull();
    });
  });

  describe('trocar o código', () => {
    it('confere o ID token contra o cliente e devolve quem é a pessoa', async () => {
      await expect(
        build().profileFromCode('codigo', 'verificador'),
      ).resolves.toEqual({
        sub: 'g-1',
        email: 'ana@gmail.com',
        emailVerified: true,
        givenName: 'Ana',
        familyName: 'Lima',
        picture: 'https://foto',
      });
      expect(mockClient.getToken).toHaveBeenCalledWith({
        code: 'codigo',
        codeVerifier: 'verificador',
      });
      expect(mockClient.verifyIdToken).toHaveBeenCalledWith({
        idToken: 'idt',
        audience: 'cid',
      });
    });

    it('sem `email_verified` verdadeiro, o e-mail não conta como confirmado', async () => {
      mockClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({ sub: 'g-1', email: 'a@x.com' }),
      });

      await expect(build().profileFromCode('c', 'v')).resolves.toMatchObject({
        emailVerified: false,
        givenName: null,
        familyName: null,
        picture: null,
      });
    });

    it('sem ID token ou sem e-mail no token é 401', async () => {
      mockClient.getToken.mockResolvedValueOnce({ tokens: {} });
      await expect(build().profileFromCode('c', 'v')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      mockClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({ sub: 'g-1' }),
      });
      await expect(build().profileFromCode('c', 'v')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  it('volta ao front no caminho pedido, com o motivo do erro quando houver', () => {
    const service = build();

    expect(service.frontUrl('/works', 'google_state')).toBe(
      'http://front.test/works?authError=google_state',
    );
    expect(service.frontUrl('/x?y=1')).toBe('http://front.test/x?y=1');
    expect(service.frontUrl('https://fora')).toBe('http://front.test/');
  });

  it('caminho seguro: só relativo do próprio front', () => {
    expect(safeRedirectPath('/perfil')).toBe('/perfil');
    expect(safeRedirectPath('//site.com')).toBe('/');
    expect(safeRedirectPath('/\\site.com')).toBe('/');
    expect(safeRedirectPath('perfil')).toBe('/');
    expect(safeRedirectPath(42)).toBe('/');
    expect(safeRedirectPath(`/${'a'.repeat(600)}`)).toBe('/');
  });
});
