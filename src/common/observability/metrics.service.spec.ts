import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
  });

  it('expõe as métricas no formato do Prometheus', async () => {
    service.recordRequest({
      method: 'GET',
      route: '/works',
      statusCode: 200,
      durationSeconds: 0.042,
    });

    const output = await service.metrics();

    expect(output).toContain('http_requests_total');
    expect(output).toContain('http_request_duration_seconds');
  });

  it('conta erro separado quando o status é 4xx ou 5xx', async () => {
    service.recordRequest({
      method: 'GET',
      route: '/works/:id',
      statusCode: 500,
      durationSeconds: 0.1,
      errorType: 'PrismaClientKnownRequestError',
    });

    const output = await service.metrics();

    expect(output).toContain('http_errors_total');
    expect(output).toContain('PrismaClientKnownRequestError');
  });

  it('não conta erro em resposta de sucesso', async () => {
    service.recordRequest({
      method: 'GET',
      route: '/epochs',
      statusCode: 200,
      durationSeconds: 0.01,
    });

    const output = await service.metrics();

    expect(output).not.toMatch(/http_errors_total\{[^}]*route="\/epochs"/);
  });

  // Permite responder "qual domínio está instável" sem instrumentar service a service.
  it('deriva o módulo a partir do primeiro segmento da rota', async () => {
    service.recordRequest({
      method: 'GET',
      route: '/blog/articles',
      statusCode: 200,
      durationSeconds: 0.01,
    });

    const output = await service.metrics();

    expect(output).toContain('module="blog"');
  });

  it('registra acerto e erro de cache por rota', async () => {
    service.recordCacheHit('/works/catalog');
    service.recordCacheMiss('/works/catalog');

    const output = await service.metrics();

    expect(output).toContain('cache_events_total');
    expect(output).toContain('result="hit"');
    expect(output).toContain('result="miss"');
  });

  it('anuncia o content-type que o Prometheus espera', () => {
    expect(service.contentType()).toContain('text/plain');
  });
});
