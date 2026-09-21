import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from '../observability/metrics.service';

interface AuthenticatedRequest extends Request {
  user?: { sub?: string; role?: string };
}

/**
 * Garante que TODA requisição (sem exceção) gera um log estruturado com
 * duração, status, rota, módulo e `requestId`, e alimenta as métricas
 * Prometheus — base da observabilidade da seção 3.9 da SPEC.
 *
 * A rota registrada é sempre o *padrão* (`/works/:id`), nunca a URL concreta:
 * agrupar por padrão é o que permite "latência P95 por rota" no Grafana, e
 * evita explodir a cardinalidade das métricas com um label por id.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const start = process.hrtime.bigint();

    return next.handle().pipe(
      tap({
        next: () => this.record(context, request, start),
        error: (error: unknown) => this.record(context, request, start, error),
      }),
    );
  }

  private record(
    context: ExecutionContext,
    request: AuthenticatedRequest,
    start: bigint,
    error?: unknown,
  ): void {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const response = context.switchToHttp().getResponse<Response>();
    const route = this.routePattern(request);

    const statusCode = error
      ? error instanceof HttpException
        ? error.getStatus()
        : 500
      : response.statusCode;

    const errorType = error
      ? error instanceof Error
        ? error.constructor.name
        : 'UnknownError'
      : undefined;

    this.metrics.recordRequest({
      method: request.method,
      route,
      statusCode,
      durationSeconds: durationMs / 1000,
      errorType,
    });

    const payload = {
      requestId: (request.headers['x-request-id'] as string) ?? undefined,
      method: request.method,
      route,
      statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      controller: context.getClass().name,
      handler: context.getHandler().name,
      userId: request.user?.sub,
      role: request.user?.role,
      ...(errorType ? { errorType } : {}),
    };

    if (statusCode >= 500) {
      this.logger.error(JSON.stringify(payload));
    } else if (statusCode >= 400) {
      this.logger.warn(JSON.stringify(payload));
    } else {
      this.logger.log(JSON.stringify(payload));
    }
  }

  private routePattern(request: AuthenticatedRequest): string {
    const path = (request.route as { path?: string } | undefined)?.path;

    if (typeof path === 'string' && path.length > 0) {
      return path;
    }

    // Sem rota casada (404, por exemplo): normaliza a URL para não vazar ids
    // concretos como label de métrica.
    return request.url
      .split('?')[0]
      .replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/:id');
  }
}
