import { Controller, Get, Logger, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Public } from '../../common/decorators/api-key.decorator';
import { AuthCookieService } from '../auth-cookie.service';
import { AuthService } from '../auth.service';
import {
  GoogleAuthError,
  GoogleAuthService,
  safeRedirectPath,
} from './google-auth.service';

/**
 * As duas pontas do login com Google. As duas são navegação do navegador, não
 * chamada de `fetch`: respondem com redirecionamento, e erro volta ao front
 * como `?authError=` em vez de uma página de JSON.
 */
@ApiTags('auth')
@Controller('auth/google')
export class GoogleAuthController {
  private readonly logger = new Logger(GoogleAuthController.name);

  constructor(
    private readonly google: GoogleAuthService,
    private readonly auth: AuthService,
    private readonly cookies: AuthCookieService,
  ) {}

  @Public()
  @Get()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Começa o login com o Google',
    description:
      'Abrir no navegador (link ou `window.location`), não por `fetch`: responde 302 para o ' +
      'Google. `redirect` é o caminho do front para onde voltar depois do login — só caminho ' +
      'relativo; qualquer outra coisa vira `/`.',
  })
  @ApiQuery({ name: 'redirect', required: false, example: '/works' })
  @ApiResponse({ status: 302, description: 'Redireciona para o Google' })
  async start(
    @Query('redirect') redirect: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    if (!this.google.isConfigured()) {
      return response.redirect(
        this.google.frontUrl(safeRedirectPath(redirect), 'google_unavailable'),
      );
    }

    const { url, cookie } = await this.google.start(redirect);

    this.cookies.setOAuthState(response, cookie);
    response.redirect(url);
  }

  @Public()
  @Get('callback')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Volta do Google',
    description:
      'Chamada pelo Google, não pelo front. Confere o `state`, troca o código, cria ou vincula ' +
      'a conta, grava a sessão nos cookies e manda o navegador de volta ao front. Em erro, ' +
      'volta com `?authError=` (`google_cancelled`, `google_state`, `google_unverified`, ' +
      '`google_failed`).',
  })
  @ApiResponse({ status: 302, description: 'Redireciona para o front' })
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const pending = this.google.readPending(
      this.cookies.readOAuthState(request),
      state,
    );

    // O estado serve uma vez só, dê certo ou não.
    this.cookies.clearOAuthState(response);

    const back = (path: string, failure?: GoogleAuthError) =>
      response.redirect(this.google.frontUrl(path, failure));

    if (error) {
      return back(
        pending?.redirect ?? '/',
        error === 'access_denied' ? 'google_cancelled' : 'google_failed',
      );
    }

    if (!pending || !code) {
      return back('/', 'google_state');
    }

    try {
      const profile = await this.google.profileFromCode(
        code,
        pending.codeVerifier,
      );

      if (!profile.emailVerified) {
        return back(pending.redirect, 'google_unverified');
      }

      const { session } = await this.auth.loginWithGoogle(profile);

      this.cookies.applySession(response, session);

      return back(pending.redirect);
    } catch (failure) {
      this.logger.warn(
        `Login com Google falhou: ${(failure as Error).message}`,
      );

      return back(pending.redirect, 'google_failed');
    }
  }
}
