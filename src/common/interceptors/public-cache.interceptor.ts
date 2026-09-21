import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import {
  PUBLIC_CACHE_KEY,
  PublicCacheOptions,
} from '../decorators/public-cache.decorator';

/**
 * Traduz `@PublicCache(...)` em `Cache-Control` de cache compartilhado.
 *
 * **O que isto compra.** O cache da aplicação (Redis) tira a carga do banco,
 * mas a requisição ainda chega ao Node: desserializar, serializar e responder.
 * Com `s-maxage`, um proxy reverso ou CDN responde sem tocar na API — o
 * tráfego anônimo do catálogo deixa de custar processo.
 *
 * `stale-while-revalidate` é o que impede que todo o tráfego caia na origem no
 * instante em que a entrada vence.
 *
 * Só age em `GET` com status de sucesso: resposta de erro ou de mutação
 * guardada por um intermediário é pior que cache nenhum.
 */
@Injectable()
export class PublicCacheInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const options = this.reflector.getAllAndOverride<PublicCacheOptions>(
      PUBLIC_CACHE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!options) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();

    if (request.method !== 'GET') {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        const response = http.getResponse<Response>();

        if (response.statusCode >= 400 || response.headersSent) {
          return;
        }

        const stale =
          options.staleWhileRevalidateSeconds ?? options.maxAgeSeconds;

        response.setHeader(
          'Cache-Control',
          `public, max-age=0, s-maxage=${options.maxAgeSeconds}, stale-while-revalidate=${stale}`,
        );
        // Sem isto, um intermediário pode devolver a variante comprimida
        // errada para um cliente que não a aceita.
        response.setHeader('Vary', 'Accept-Encoding');
      }),
    );
  }
}
