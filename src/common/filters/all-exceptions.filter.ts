import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { errorStack } from '../utils/error.util';
import { SentryService } from '../observability/sentry.service';

export interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
  requestId?: string;
}

interface AuthenticatedRequest extends Request {
  user?: { sub?: string; role?: string };
}

/**
 * Filtro global de exceções. Captura TUDO (HttpException e erros não tratados),
 * normaliza o formato de resposta e garante que detalhes internos NUNCA vazem
 * para o cliente em produção.
 *
 * Duas regras que este filtro separa de propósito (seção 3.9.1 da SPEC):
 *
 * 1. **Resposta HTTP**: em produção, erro não tratado vira uma mensagem
 *    genérica — nunca a mensagem interna, nunca stack.
 * 2. **Log interno**: o stack trace é registrado *sempre*, inclusive em
 *    produção. Antes ele era omitido justamente onde é mais necessário, o que
 *    deixava todo 5xx de produção sem rastro de origem.
 *
 * É também o ponto central de reporte para o Sentry.
 */
@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  // `@Optional()` de propósito: o filtro precisa funcionar sem o
  // `ObservabilityModule` — o `PrismaExceptionFilter` o instancia diretamente
  // (`new AllExceptionsFilter()`) para delegar a formatação da resposta, e os
  // testes o montam sem a camada de observabilidade.
  constructor(@Optional() private readonly sentry?: SentryService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<AuthenticatedRequest>();
    const requestId = (request.headers['x-request-id'] as string) ?? undefined;

    // Homologação é URL pública: esconde o detalhe interno como produção.
    const isDeployed =
      process.env.NODE_ENV === 'production' ||
      process.env.NODE_ENV === 'staging';

    let statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'Internal Server Error';
    let message: string | string[] = 'Erro interno do servidor';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        error = exception.name;
      } else if (typeof exceptionResponse === 'object') {
        const body = exceptionResponse as Record<string, unknown>;
        message =
          (body.message as string | string[] | undefined) ?? exception.message;
        error = (body.error as string | undefined) ?? exception.name;
      }
    } else if (exception instanceof Error) {
      // Erro não tratado (bug real) — nunca expor detalhes internos em produção.
      message = isDeployed ? 'Erro interno do servidor' : exception.message;
      error = 'Internal Server Error';
    }

    const body: ErrorResponseBody = {
      statusCode,
      error,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
      requestId,
    };

    // O stack vai SEMPRE para o log interno, inclusive em produção.
    const logPayload = {
      requestId,
      method: request.method,
      path: request.url,
      statusCode,
      userId: request.user?.sub,
      role: request.user?.role,
      exception:
        exception instanceof Error
          ? exception.constructor.name
          : typeof exception,
      stack: errorStack(exception),
    };

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `[${requestId}] ${request.method} ${request.url} -> ${statusCode}`,
        JSON.stringify(logPayload),
      );

      this.sentry?.captureException(exception, {
        requestId,
        method: request.method,
        path: request.url,
        statusCode,
        userId: request.user?.sub,
      });
    } else {
      this.logger.warn(
        `[${requestId}] ${request.method} ${request.url} -> ${statusCode}`,
      );
    }

    response.status(statusCode).json(body);
  }
}
