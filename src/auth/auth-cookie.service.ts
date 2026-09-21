import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';
import { AuthResponseDto } from './dto/auth-response.dto';
import { IssuedSession } from './interfaces/issued-session.interface';

export const ACCESS_TOKEN_COOKIE = 'opus_access_token';
export const REFRESH_TOKEN_COOKIE = 'opus_refresh_token';
export const OAUTH_STATE_COOKIE = 'opus_oauth_state';

/**
 * Marcador de "esta pessoa tem sessão". Não é credencial: só diz que existe um
 * refresh token válido a tentar.
 *
 * **Por que é preciso.** O cookie de acesso vive 15 minutos e o navegador o
 * descarta ao vencer; o de refresh tem `path=/api/auth` e o servidor do Next
 * nunca o recebe. Sem um terceiro sinal, o middleware do front não distingue
 * "visitante" de "sessão com token vencido", e deixa de renovar numa navegação
 * — a pessoa vê a página como deslogada até o navegador renovar sozinho.
 *
 * O front usava o cookie do NextAuth para isso. Com o NextAuth fora (Etapa 7),
 * este ocupa o lugar. Não é `httpOnly` de propósito: não carrega segredo algum
 * e o front pode querer lê-lo.
 */
export const SESSION_HINT_COOKIE = 'opus_session';

/**
 * Vida do cookie de refresh, alinhada ao `JWT_REFRESH_EXPIRES_IN` padrão (7d).
 * O token em si continua sendo validado no banco (`UserToken`), então um cookie
 * sobrevivente a uma revogação não concede acesso.
 */
export const REFRESH_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const AUTH_PATH = '/api/auth';
const OAUTH_PATH = '/api/auth/google';
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Os cookies da sessão (SPEC §3.3 e §4.6).
 *
 * - **Token de acesso**: `httpOnly`, `path=/`. Vai em toda chamada à API e em
 *   toda página do front no mesmo domínio — é o que deixa o servidor do Next
 *   saber quem está logado ao renderizar `/admin` ou `/profile`. A API lê o
 *   cabeçalho `Authorization` primeiro e o cookie depois.
 * - **Refresh token**: `httpOnly`, `path=/api/auth`. Só acompanha as rotas de
 *   autenticação, o que reduz a superfície de vazamento.
 *
 * Nenhum dos dois é legível por JavaScript: um XSS no front não leva a sessão.
 * Com `domain` no domínio raiz, a mesma sessão vale nas 4 zonas do front. Toda
 * mutação autenticada por cookie passa pelo `OriginGuard` (CSRF).
 */
@Injectable()
export class AuthCookieService {
  constructor(private readonly configService: ConfigService) {}

  /** Grava os dois cookies e devolve o corpo da resposta. */
  applySession(response: Response, session: IssuedSession): AuthResponseDto {
    response.cookie(ACCESS_TOKEN_COOKIE, session.accessToken, {
      ...this.baseOptions('/'),
      maxAge: session.expiresIn * 1000,
    });
    response.cookie(REFRESH_TOKEN_COOKIE, session.refreshToken, {
      ...this.baseOptions(AUTH_PATH),
      maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS * 1000,
    });
    // Acompanha a vida do refresh: enquanto ele puder ser trocado, o front
    // sabe que vale a pena tentar renovar. Ver `SESSION_HINT_COOKIE`.
    response.cookie(SESSION_HINT_COOKIE, '1', {
      ...this.baseOptions('/'),
      httpOnly: false,
      maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS * 1000,
    });

    const body: AuthResponseDto = {
      expiresIn: session.expiresIn,
      user: session.user,
    };

    if (this.shouldReturnTokenInBody()) {
      body.accessToken = session.accessToken;
      body.refreshToken = session.refreshToken;
    }

    return body;
  }

  /** `clearCookie` só apaga quando os atributos batem com os da emissão. */
  clearSession(response: Response): void {
    response.clearCookie(ACCESS_TOKEN_COOKIE, this.baseOptions('/'));
    response.clearCookie(REFRESH_TOKEN_COOKIE, this.baseOptions(AUTH_PATH));
    response.clearCookie(SESSION_HINT_COOKIE, {
      ...this.baseOptions('/'),
      httpOnly: false,
    });
  }

  /**
   * Lê o refresh token do cookie e, se não houver, do corpo da requisição.
   *
   * O fallback pelo corpo existe para clientes não-browser. Cookie tem
   * precedência para que a migração do front não precise de coordenação.
   */
  extractRefreshToken(
    request: Request,
    bodyToken?: string,
  ): string | undefined {
    return cookiesOf(request)?.[REFRESH_TOKEN_COOKIE] ?? bodyToken;
  }

  /**
   * Login com Google em andamento: `state` e verificador do PKCE.
   *
   * Dez minutos, só nas rotas do Google. `sameSite=lax` é o que deixa o cookie
   * voltar na navegação que o Google faz de volta para o callback.
   */
  setOAuthState(response: Response, value: string): void {
    response.cookie(OAUTH_STATE_COOKIE, value, {
      ...this.baseOptions(OAUTH_PATH),
      maxAge: OAUTH_STATE_MAX_AGE_MS,
    });
  }

  readOAuthState(request: Request): string | undefined {
    return cookiesOf(request)?.[OAUTH_STATE_COOKIE];
  }

  clearOAuthState(response: Response): void {
    response.clearCookie(OAUTH_STATE_COOKIE, this.baseOptions(OAUTH_PATH));
  }

  /**
   * Em produção os tokens saem apenas pelos cookies. Fora de produção eles
   * também voltam no corpo, para permitir testar os fluxos pelo Swagger e por
   * `curl` sem um cliente que guarde cookie.
   */
  shouldReturnTokenInBody(): boolean {
    return this.configService.get<string>('app.nodeEnv') !== 'production';
  }

  private baseOptions(path: string): CookieOptions {
    const isProduction =
      this.configService.get<string>('app.nodeEnv') === 'production';
    const domain = this.configService.get<string>('auth.cookieDomain');

    return {
      httpOnly: true,
      // Sem HTTPS em desenvolvimento o cookie `secure` nunca seria gravado.
      secure: isProduction,
      // `lax` permite navegação entre as zonas do front mantendo proteção
      // contra CSRF em requisição cross-site de outros domínios.
      sameSite: 'lax',
      path,
      ...(domain ? { domain } : {}),
    };
  }
}

function cookiesOf(request: Request): Record<string, string> | undefined {
  return (request as Request & { cookies?: Record<string, string> }).cookies;
}
