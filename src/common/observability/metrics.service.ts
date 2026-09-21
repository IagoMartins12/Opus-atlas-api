import { Injectable } from '@nestjs/common';
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

/**
 * Métricas Prometheus da API (seção 3.9.2 da SPEC).
 *
 * As labels foram escolhidas para responder, direto no dashboard e sem query
 * nova, as perguntas do documento: quais rotas mais erram, qual módulo está
 * instável, qual rota está lenta e qual é a taxa de acerto do cache.
 *
 * `route` é sempre o *padrão* da rota (`/works/:id`), nunca a URL concreta —
 * usar a URL real explodiria a cardinalidade da métrica.
 */
@Injectable()
export class MetricsService {
  private readonly registry = new Registry();

  private readonly httpRequestsTotal: Counter<
    'method' | 'route' | 'status_code' | 'module'
  >;

  private readonly httpRequestDuration: Histogram<
    'method' | 'route' | 'module'
  >;

  private readonly httpErrorsTotal: Counter<
    'method' | 'route' | 'status_code' | 'error_type' | 'module'
  >;

  private readonly cacheEventsTotal: Counter<'route' | 'result'>;

  constructor() {
    collectDefaultMetrics({ register: this.registry });

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total de requisições HTTP atendidas',
      labelNames: ['method', 'route', 'status_code', 'module'],
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duração das requisições HTTP em segundos',
      labelNames: ['method', 'route', 'module'],
      // Faixas centradas no SLO de 500ms da SPEC, com cauda até 10s.
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.httpErrorsTotal = new Counter({
      name: 'http_errors_total',
      help: 'Total de respostas de erro, separadas por tipo de exceção',
      labelNames: ['method', 'route', 'status_code', 'error_type', 'module'],
      registers: [this.registry],
    });

    this.cacheEventsTotal = new Counter({
      name: 'cache_events_total',
      help: 'Acertos e erros de cache por rota',
      labelNames: ['route', 'result'],
      registers: [this.registry],
    });
  }

  recordRequest(params: {
    method: string;
    route: string;
    statusCode: number;
    durationSeconds: number;
    errorType?: string;
  }): void {
    const module = this.moduleFromRoute(params.route);
    const statusCode = String(params.statusCode);

    this.httpRequestsTotal.inc({
      method: params.method,
      route: params.route,
      status_code: statusCode,
      module,
    });

    this.httpRequestDuration.observe(
      { method: params.method, route: params.route, module },
      params.durationSeconds,
    );

    if (params.statusCode >= 400) {
      this.httpErrorsTotal.inc({
        method: params.method,
        route: params.route,
        status_code: statusCode,
        error_type: params.errorType ?? 'Unknown',
        module,
      });
    }
  }

  recordCacheHit(route: string): void {
    this.cacheEventsTotal.inc({ route, result: 'hit' });
  }

  recordCacheMiss(route: string): void {
    this.cacheEventsTotal.inc({ route, result: 'miss' });
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }

  /**
   * Deriva o módulo de domínio a partir do primeiro segmento da rota, para
   * permitir "taxa de erro por módulo" sem instrumentar service por service.
   */
  private moduleFromRoute(route: string): string {
    const segment = route.split('/').filter(Boolean)[0];

    if (!segment) {
      return 'root';
    }

    return segment.startsWith(':') ? 'root' : segment;
  }
}
