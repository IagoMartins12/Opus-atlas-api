import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { AUDIT_ACTION_KEY, AuditOptions } from './audit.decorator';
import { AuditService } from './audit.service';

interface AuditableRequest extends Request {
  /** O papel vem do token como número (`AccessTokenPayload.role`). */
  user?: { sub?: string; role?: number | string };
}

/**
 * Grava a trilha de auditoria das rotas anotadas com `@Audited()`.
 *
 * Registra sucesso e falha: uma tentativa de exclusão negada por permissão é
 * exatamente o tipo de evento que uma auditoria de segurança precisa mostrar.
 * O corpo da requisição não é registrado — evita gravar senha, token ou dado de
 * cartão numa tabela que existe justamente para ser lida por humanos.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<AuditOptions | undefined>(
      AUDIT_ACTION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!options || context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuditableRequest>();

    const base = {
      actorId: request.user?.sub,
      // A coluna é texto e o papel do token é número: passado cru, o Prisma
      // recusava a gravação e a trilha ficava vazia.
      actorRole:
        request.user?.role !== undefined
          ? String(request.user.role)
          : undefined,
      action: options.action,
      entityType: options.entityType,
      entityId: options.entityIdParam
        ? (request.params?.[options.entityIdParam] as string | undefined)
        : undefined,
      ipAddress: this.resolveIp(request),
      userAgent: request.headers['user-agent'],
      requestId: request.headers['x-request-id'] as string | undefined,
    };

    return next.handle().pipe(
      tap(() => {
        void this.auditService.record({ ...base, success: true });
      }),
      catchError((error: unknown) => {
        void this.auditService.record({
          ...base,
          success: false,
          metadata: {
            error: error instanceof Error ? error.name : 'UnknownError',
          },
        });

        return throwError(() => error);
      }),
    );
  }

  private resolveIp(request: AuditableRequest): string | undefined {
    const forwardedFor = request.headers['x-forwarded-for'];

    if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
      return forwardedFor.split(',')[0].trim();
    }

    return request.ip;
  }
}
