import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';

interface AuthenticatedRequest extends Request {
  user?: { sub?: string };
}

/**
 * Guard de rate limit com duas correções sobre o comportamento padrão.
 *
 * **1. IP real atrás de proxy.** Com a API atrás de Nginx/Cloudflare/ALB,
 * `req.ip` é o IP do proxy — o mesmo para todo mundo. O limite global viraria
 * um limite compartilhado por todos os usuários, e um único cliente abusivo
 * bloquearia a plataforma inteira. Aqui o primeiro endereço de
 * `X-Forwarded-For` é usado como identidade.
 *
 * **2. Identidade por usuário quando há sessão.** Limitar só por IP pune quem
 * está atrás de NAT compartilhado (escola, empresa, operadora móvel) e é fácil
 * de contornar trocando de IP. Requisição autenticada é rastreada pelo id do
 * usuário; requisição anônima cai no IP.
 *
 * Para o `X-Forwarded-For` ser confiável, `trust proxy` precisa estar
 * habilitado no Express — configurado no `bootstrap` (`main.ts`).
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(
    req: Record<string, unknown>,
  ): Promise<string> {
    const request = req as unknown as AuthenticatedRequest;

    const userId = request.user?.sub;
    if (userId) {
      return `user:${userId}`;
    }

    return `ip:${this.resolveIp(request)}`;
  }

  private resolveIp(request: AuthenticatedRequest): string {
    const forwardedFor = request.headers?.['x-forwarded-for'];

    if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
      return forwardedFor.split(',')[0].trim();
    }

    if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
      return forwardedFor[0].split(',')[0].trim();
    }

    return request.ip ?? 'unknown';
  }
}
