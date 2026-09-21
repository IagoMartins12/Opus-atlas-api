import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/api-key.decorator';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Rotas server-to-server, que não vêm de um navegador e não têm `Origin`. */
const EXEMPT_PATH_PREFIXES = ['/api/webhook', '/api/cron', '/api/metrics'];

/**
 * Defesa contra CSRF em requisições que carregam cookie (SPEC §3.3).
 *
 * Com o refresh token em cookie, um site malicioso pode fazer o navegador da
 * vítima disparar `POST /api/auth/refresh` — o cookie viaja junto. `SameSite=lax`
 * já bloqueia a maior parte desses casos, mas é uma proteção do navegador, não
 * do servidor: navegador antigo ou requisição de mesmo site com subdomínio
 * comprometido passa.
 *
 * Aqui a validação é feita no servidor: toda mutação precisa apresentar
 * `Origin` (ou `Referer`) pertencente à allowlist do CORS. Requisição com
 * `Authorization: Bearer` é liberada, porque um atacante não consegue fazer o
 * navegador anexar esse header automaticamente — o risco é exclusivo do cookie.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly logger = new Logger(OriginGuard.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    if (!MUTATING_METHODS.has(request.method)) {
      return true;
    }

    if (
      EXEMPT_PATH_PREFIXES.some((prefix) => request.path.startsWith(prefix))
    ) {
      return true;
    }

    // Sessão via Bearer não é vulnerável a CSRF.
    if (request.headers.authorization?.startsWith('Bearer ')) {
      return true;
    }

    const allowed = this.configService.get<string[]>('cors.allowedOrigins', []);
    const origin = this.resolveOrigin(request);

    // Sem cookie e sem Origin, não há nada que um navegador possa ter forjado
    // (curl, teste de integração, chamada interna) — deixa passar.
    if (!origin) {
      const hasCookie = Boolean(request.headers.cookie);
      if (!hasCookie) {
        return true;
      }

      this.logger.warn(
        `Mutação com cookie e sem Origin bloqueada: ${request.method} ${request.path}`,
      );
      throw new ForbiddenException('Origem da requisição não informada');
    }

    if (!allowed.includes(origin)) {
      this.logger.warn(
        `Mutação bloqueada por origem não permitida "${origin}": ${request.method} ${request.path}`,
      );
      throw new ForbiddenException('Origem da requisição não permitida');
    }

    return true;
  }

  /** Normaliza `Origin`, caindo para o esquema+host do `Referer`. */
  private resolveOrigin(request: Request): string | undefined {
    const origin = request.headers.origin;
    if (typeof origin === 'string' && origin.length > 0) {
      return origin;
    }

    const referer = request.headers.referer;
    if (typeof referer === 'string' && referer.length > 0) {
      try {
        return new URL(referer).origin;
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  /** Mantido para simetria com os demais guards que leem `@Public()`. */
  protected isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false
    );
  }
}
