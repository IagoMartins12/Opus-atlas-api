import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { GoogleProfile } from '../interfaces/google-profile.interface';

/** Motivo que volta ao front em `?authError=` — a tela decide a mensagem. */
export type GoogleAuthError =
  | 'google_unavailable'
  | 'google_cancelled'
  | 'google_state'
  | 'google_unverified'
  | 'google_failed';

export interface PendingGoogleLogin {
  state: string;
  codeVerifier: string;
  /** Caminho do front para onde voltar depois do login. */
  redirect: string;
}

/**
 * Login com o Google pelo fluxo de código de autorização, com PKCE.
 *
 * Quem fala com o Google é a API, não o front: o navegador vai a
 * `GET /auth/google`, que o manda ao Google; o Google devolve para
 * `GET /auth/google/callback` com um código; a API troca o código pelo ID
 * token, confere assinatura e audiência, e só então cria ou vincula a conta.
 * Nenhum token do Google passa por JavaScript do front, e nenhum é guardado.
 *
 * O `state` e o verificador do PKCE ficam num cookie `httpOnly` de dez
 * minutos, restrito às rotas do Google. É o que prova, na volta, que o login
 * foi começado por este navegador — sem isso, alguém poderia fazer a vítima
 * entrar na conta *dele* (login CSRF) e colher o que ela fizesse depois.
 */
@Injectable()
export class GoogleAuthService {
  private client?: OAuth2Client;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('auth.google.clientId') &&
        this.config.get<string>('auth.google.clientSecret') &&
        this.config.get<string>('auth.google.redirectUri'),
    );
  }

  /** Endereço do Google e o valor do cookie que guarda o login em andamento. */
  async start(redirect?: string): Promise<{ url: string; cookie: string }> {
    const client = this.oauthClient();
    const state = crypto.randomBytes(24).toString('base64url');
    const { codeVerifier, codeChallenge } =
      await client.generateCodeVerifierAsync();

    const url = client.generateAuthUrl({
      scope: ['openid', 'email', 'profile'],
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      // Deixa escolher a conta: quem tem duas contas Google não fica preso à
      // que o navegador lembrar.
      prompt: 'select_account',
    });

    const pending: PendingGoogleLogin = {
      state,
      codeVerifier,
      redirect: safeRedirectPath(redirect),
    };

    return {
      url,
      cookie: Buffer.from(JSON.stringify(pending)).toString('base64url'),
    };
  }

  /** Confere o `state` devolvido pelo Google contra o cookie. */
  readPending(
    cookie: string | undefined,
    state: string | undefined,
  ): PendingGoogleLogin | null {
    if (!cookie || !state) {
      return null;
    }

    let pending: Partial<PendingGoogleLogin>;

    try {
      pending = JSON.parse(
        Buffer.from(cookie, 'base64url').toString('utf8'),
      ) as Partial<PendingGoogleLogin>;
    } catch {
      return null;
    }

    if (
      typeof pending?.state !== 'string' ||
      typeof pending.codeVerifier !== 'string'
    ) {
      return null;
    }

    const expected = Buffer.from(pending.state);
    const received = Buffer.from(state);

    if (
      expected.length !== received.length ||
      !crypto.timingSafeEqual(expected, received)
    ) {
      return null;
    }

    return {
      state: pending.state,
      codeVerifier: pending.codeVerifier,
      redirect: safeRedirectPath(pending.redirect),
    };
  }

  /** Troca o código pelo ID token e devolve quem é a pessoa. */
  async profileFromCode(
    code: string,
    codeVerifier: string,
  ): Promise<GoogleProfile> {
    const client = this.oauthClient();
    const { tokens } = await client.getToken({ code, codeVerifier });

    if (!tokens.id_token) {
      throw new UnauthorizedException('O Google não devolveu a identificação');
    }

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: this.config.get<string>('auth.google.clientId'),
    });
    const payload = ticket.getPayload();

    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException('Identificação do Google incompleta');
    }

    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      givenName: payload.given_name ?? null,
      familyName: payload.family_name ?? null,
      picture: payload.picture ?? null,
    };
  }

  /** Endereço do front para onde o navegador volta. */
  frontUrl(path: string, error?: GoogleAuthError): string {
    const base = this.config.get<string>(
      'mediaSearch.frontendBaseUrl',
      'http://localhost:3000',
    );
    const url = new URL(safeRedirectPath(path), base);

    if (error) {
      url.searchParams.set('authError', error);
    }

    return url.toString();
  }

  private oauthClient(): OAuth2Client {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('Login com Google não configurado');
    }

    this.client ??= new OAuth2Client({
      clientId: this.config.get<string>('auth.google.clientId'),
      clientSecret: this.config.get<string>('auth.google.clientSecret'),
      redirectUri: this.config.get<string>('auth.google.redirectUri'),
    });

    return this.client;
  }
}

/**
 * Só caminho relativo do próprio front.
 *
 * `redirect` vem da URL: sem esta trava, `?redirect=https://site-falso` faria
 * a API mandar a pessoa, recém-logada, para fora (open redirect). `//site` e
 * `/\site` também são endereço externo para o navegador.
 */
export function safeRedirectPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.startsWith('/\\') ||
    value.length > 512
  ) {
    return '/';
  }

  return value;
}
