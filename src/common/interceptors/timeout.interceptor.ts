import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  RequestTimeoutException,
} from '@nestjs/common';
import { Observable, throwError, TimeoutError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import { Request } from 'express';

/** Teto padrão de uma requisição HTTP. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Rotas que legitimamente demoram mais que o teto padrão e não devem ser
 * cortadas: scraping sob demanda e o job diário de assinaturas.
 */
const LONG_RUNNING_PREFIXES = ['/api/scrapers', '/api/cron'];

/**
 * Interrompe requisições que passam do teto de tempo (SPEC §3.1, `TimeoutInterceptor`).
 *
 * Sem isso, uma query lenta ou um provedor externo travado segura a conexão
 * indefinidamente: o cliente fica esperando, o pool de conexões do banco não é
 * devolvido e, sob carga, a API para de aceitar requisições novas mesmo com
 * CPU ociosa. Cortar em 30s troca uma indisponibilidade silenciosa por um 408
 * explícito, que aparece nas métricas.
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();

    if (
      LONG_RUNNING_PREFIXES.some((prefix) => request.path.startsWith(prefix))
    ) {
      return next.handle();
    }

    return next.handle().pipe(
      timeout(DEFAULT_TIMEOUT_MS),
      catchError((error: unknown) =>
        throwError(() =>
          error instanceof TimeoutError
            ? new RequestTimeoutException(
                'A requisição excedeu o tempo limite do servidor',
              )
            : error,
        ),
      ),
    );
  }
}
