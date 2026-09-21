// `@nestjs/jwt@12` é ESM puro e o ts-jest não o lê; o controller só precisa
// do tipo do AuthService.
jest.mock('@nestjs/jwt', () => ({ JwtService: class JwtService {} }));

import type { Request, Response } from 'express';
import { AuthCookieService } from '../auth-cookie.service';
import { AuthService } from '../auth.service';
import { GoogleAuthController } from './google-auth.controller';
import { GoogleAuthService } from './google-auth.service';

const profile = {
  sub: 'g-1',
  email: 'ana@gmail.com',
  emailVerified: true,
  givenName: 'Ana',
  familyName: null,
  picture: null,
};
const session = { accessToken: 'a', refreshToken: 'r' };

describe('GoogleAuthController', () => {
  let google: Record<string, jest.Mock>;
  let auth: { loginWithGoogle: jest.Mock };
  let cookies: Record<string, jest.Mock>;
  let response: { redirect: jest.Mock };
  let controller: GoogleAuthController;
  const request = {} as Request;
  const res = () => response as unknown as Response;

  beforeEach(() => {
    google = {
      isConfigured: jest.fn().mockReturnValue(true),
      start: jest
        .fn()
        .mockResolvedValue({ url: 'https://google/auth', cookie: 'estado' }),
      readPending: jest.fn().mockReturnValue({
        state: 's',
        codeVerifier: 'v',
        redirect: '/works',
      }),
      profileFromCode: jest.fn().mockResolvedValue(profile),
      frontUrl: jest.fn(
        (path: string, error?: string) =>
          `http://front${path}${error ? `?authError=${error}` : ''}`,
      ),
    };
    auth = {
      loginWithGoogle: jest
        .fn()
        .mockResolvedValue({ session, isNewUser: false }),
    };
    cookies = {
      setOAuthState: jest.fn(),
      readOAuthState: jest.fn().mockReturnValue('estado'),
      clearOAuthState: jest.fn(),
      applySession: jest.fn(),
    };
    response = { redirect: jest.fn() };
    controller = new GoogleAuthController(
      google as unknown as GoogleAuthService,
      auth as unknown as AuthService,
      cookies as unknown as AuthCookieService,
    );
  });

  describe('começar', () => {
    it('guarda o estado no cookie e manda ao Google', async () => {
      await controller.start('/works', res());

      expect(google.start).toHaveBeenCalledWith('/works');
      expect(cookies.setOAuthState).toHaveBeenCalledWith(res(), 'estado');
      expect(response.redirect).toHaveBeenCalledWith('https://google/auth');
    });

    it('sem configuração, volta ao front com o motivo', async () => {
      google.isConfigured.mockReturnValue(false);

      await controller.start('/works', res());

      expect(google.start).not.toHaveBeenCalled();
      expect(response.redirect).toHaveBeenCalledWith(
        'http://front/works?authError=google_unavailable',
      );
    });
  });

  describe('volta do Google', () => {
    const callback = (code?: string, error?: string) =>
      controller.callback(code, 's', error, request, res());

    it('troca o código, grava a sessão e volta ao destino pedido', async () => {
      await callback('codigo');

      expect(cookies.clearOAuthState).toHaveBeenCalledWith(res());
      expect(google.profileFromCode).toHaveBeenCalledWith('codigo', 'v');
      expect(auth.loginWithGoogle).toHaveBeenCalledWith(profile);
      expect(cookies.applySession).toHaveBeenCalledWith(res(), session);
      expect(response.redirect).toHaveBeenCalledWith('http://front/works');
    });

    it('quem desiste no Google volta com "cancelado"; outro erro do Google, "falhou"', async () => {
      await callback(undefined, 'access_denied');
      expect(response.redirect).toHaveBeenLastCalledWith(
        'http://front/works?authError=google_cancelled',
      );

      await callback(undefined, 'server_error');
      expect(response.redirect).toHaveBeenLastCalledWith(
        'http://front/works?authError=google_failed',
      );
      expect(auth.loginWithGoogle).not.toHaveBeenCalled();
    });

    it('estado que não confere ou código ausente não entra', async () => {
      google.readPending.mockReturnValue(null);
      await callback('codigo');
      expect(response.redirect).toHaveBeenLastCalledWith(
        'http://front/?authError=google_state',
      );

      google.readPending.mockReturnValue({
        state: 's',
        codeVerifier: 'v',
        redirect: '/works',
      });
      await callback(undefined);
      expect(response.redirect).toHaveBeenLastCalledWith(
        'http://front/?authError=google_state',
      );
      expect(google.profileFromCode).not.toHaveBeenCalled();
    });

    it('e-mail que o Google não confirmou não entra', async () => {
      google.profileFromCode.mockResolvedValue({
        ...profile,
        emailVerified: false,
      });

      await callback('codigo');

      expect(auth.loginWithGoogle).not.toHaveBeenCalled();
      expect(response.redirect).toHaveBeenCalledWith(
        'http://front/works?authError=google_unverified',
      );
    });

    it('falha na troca volta ao front, sem sessão', async () => {
      google.profileFromCode.mockRejectedValue(new Error('rede'));

      await callback('codigo');

      expect(cookies.applySession).not.toHaveBeenCalled();
      expect(response.redirect).toHaveBeenCalledWith(
        'http://front/works?authError=google_failed',
      );
    });
  });
});
