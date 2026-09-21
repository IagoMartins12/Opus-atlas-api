import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/node';

export interface SentryErrorContext {
  requestId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  /** Só o id do usuário — nunca e-mail, nome ou qualquer dado pessoal. */
  userId?: string;
}

/**
 * Error tracking centralizado (seção 3.9.3 da SPEC).
 *
 * O serviço é sempre injetável; se `SENTRY_DSN` não estiver configurado ele
 * entra em modo inativo e não faz nada — assim dev e testes rodam sem
 * dependência externa, e produção só precisa da env.
 */
@Injectable()
export class SentryService implements OnModuleInit {
  private readonly logger = new Logger(SentryService.name);
  private enabled = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const dsn = this.configService.get<string>('observability.sentryDsn');

    if (!dsn) {
      this.logger.log(
        'SENTRY_DSN não configurado — error tracking desativado neste ambiente',
      );
      return;
    }

    Sentry.init({
      dsn,
      environment: this.configService.get<string>('app.nodeEnv', 'development'),
      // Marca o deploy corrente para correlacionar regressão a release.
      release: this.configService.get<string>('observability.release'),
      tracesSampleRate: this.configService.get<number>(
        'observability.tracesSampleRate',
        0,
      ),
      // Nunca enviar corpo de requisição, cookie ou header de autenticação.
      sendDefaultPii: false,
    });

    this.enabled = true;
    this.logger.log('Sentry inicializado');
  }

  captureException(exception: unknown, context: SentryErrorContext = {}): void {
    if (!this.enabled) {
      return;
    }

    Sentry.withScope((scope) => {
      if (context.requestId) {
        scope.setTag('requestId', context.requestId);
      }
      if (context.method && context.path) {
        scope.setTag('route', `${context.method} ${context.path}`);
      }
      if (context.statusCode) {
        scope.setTag('statusCode', String(context.statusCode));
      }
      if (context.userId) {
        scope.setUser({ id: context.userId });
      }

      Sentry.captureException(exception);
    });
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
