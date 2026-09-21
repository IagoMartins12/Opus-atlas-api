import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';
import { AuthResponseDto } from './dto/auth-response.dto';
import { IssuedSession } from './interfaces/issued-session.interface';

/**
 * Nomes dos cookies da sessão, com o prefixo do ambiente.
 *
 * **Por que o prefixo existe.** Homologação vive sob o domínio de produção
 * (`hml.opusatlas.com.br`), e o navegador manda os cookies de
 * `.opusatlas.com.br` também para os subdomínios. Com os mesmos nomes, quem
 * está logado em produção chegaria à homologação com dois `opus_access_token`,
 * e qual deles se lê depende da ordem do navegador. `AUTH_COOKIE_PREFIX=opus_hml`
 * na homologação (e `NEXT_PUBLIC_AUTH_COOKIE_PREFIX` igual no front); em
 * produção, nada — o padrão é `opus`.
 *
 * **Por que é função, e não constante.** Uma constante seria calculada no
 * `import`, antes de o `ConfigModule` carregar o `.env.*` para o
 * `process.env`: o prefixo declarado no arquivo seria ignorado em silêncio, e o
 * login quebraria sem explicação. Lido na hora do uso, vale venha de onde vier.
 */
export function authCookieNames(): {
  access: string;
  refresh: string;
  oauthState: string;
  sessionHint: string;
} {
  const prefixo = process.env.AUTH_COOKIE_PREFIX?.trim() || 'opus';

  return {
    access: `${prefixo}_access_token`,
    refresh: `${prefixo}_refresh_token`,
    oauthState: `${prefixo}_oauth_state`,
    sessionHint: `${prefixo}_session`,
  };
}

/*
 * `sessionHint` — marcador de "esta pessoa tem sessão". Não é credencial: só
 * diz que existe um refresh token válido a tentar.
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
    response.cookie(authCookieNames().access, session.accessToken, {
      ...this.baseOptions('/'),
      maxAge: session.expiresIn * 1000,
    });
    response.cookie(authCookieNames().refresh, session.refreshToken, {
      ...this.baseOptions(AUTH_PATH),
      maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS * 1000,
    });
    // Acompanha a vida do refresh: enquanto ele puder ser trocado, o front
    // sabe que vale a pena tentar renovar. Ver `sessionHint` em `authCookieNames`.
    response.cookie(authCookieNames().sessionHint, '1', {
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
    response.clearCookie(authCookieNames().access, this.baseOptions('/'));
    response.clearCookie(
      authCookieNames().refresh,
      this.baseOptions(AUTH_PATH),
    );
    response.clearCookie(authCookieNames().sessionHint, {
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
    return cookiesOf(request)?.[authCookieNames().refresh] ?? bodyToken;
  }

  /**
   * Login com Google em andamento: `state` e verificador do PKCE.
   *
   * Dez minutos, só nas rotas do Google. `sameSite=lax` é o que deixa o cookie
   * voltar na navegação que o Google faz de volta para o callback.
   */
  setOAuthState(response: Response, value: string): void {
    response.cookie(authCookieNames().oauthState, value, {
      ...this.baseOptions(OAUTH_PATH),
      maxAge: OAUTH_STATE_MAX_AGE_MS,
    });
  }

  readOAuthState(request: Request): string | undefined {
    return cookiesOf(request)?.[authCookieNames().oauthState];
  }

  clearOAuthState(response: Response): void {
    response.clearCookie(
      authCookieNames().oauthState,
      this.baseOptions(OAUTH_PATH),
    );
  }

  /**
   * Em ambiente publicado os tokens saem apenas pelos cookies. Em
   * desenvolvimento eles também voltam no corpo, para testar os fluxos pelo
   * Swagger e por `curl` sem um cliente que guarde cookie.
   *
   * Homologação conta como publicado, e não por formalidade: se o front
   * passasse a depender do token no corpo, homologação aprovaria e produção
   * quebraria. E token no corpo é legível por JavaScript — um XSS levaria a
   * sessão que o `httpOnly` existe para proteger.
   */
  shouldReturnTokenInBody(): boolean {
    return !this.isDeployed();
  }

  /** Produção ou homologação: onde o comportamento tem de ser o de verdade. */
  private isDeployed(): boolean {
    const nodeEnv = this.configService.get<string>('app.nodeEnv');
    return nodeEnv === 'production' || nodeEnv === 'staging';
  }

  private baseOptions(path: string): CookieOptions {
    const domain = this.configService.get<string>('auth.cookieDomain');

    return {
      httpOnly: true,
      // Sem HTTPS em desenvolvimento o cookie `secure` nunca seria gravado.
      // Homologação tem HTTPS e precisa do mesmo cookie que produção.
      secure: this.isDeployed(),
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
