import {
  CallHandler,
  ExecutionContext,
  HttpException,
  RequestTimeoutException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef, Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError, NEVER } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditInterceptor } from './audit/audit.interceptor';
import { AuditService } from './audit/audit.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { TimeoutInterceptor } from './interceptors/timeout.interceptor';
import { MetricsService } from './observability/metrics.service';
import { SentryService } from './observability/sentry.service';
import { JobStatusService } from './queue/job-status.service';
import { TextIndexService } from './search/text-index.service';
import { CloudinaryService } from './storage/cloudinary.service';
import { StorageCleanupService } from './storage/storage-cleanup.service';
import { AppThrottlerGuard } from './throttler/app-throttler.guard';

jest.mock('@sentry/node', () => {
  const scope = { setTag: jest.fn(), setUser: jest.fn() };
  return {
    init: jest.fn(),
    captureException: jest.fn(),
    withScope: jest.fn((fn: (s: typeof scope) => void) => fn(scope)),
    __scope: scope,
  };
});
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sentry = jest.requireMock('@sentry/node') as {
  init: jest.Mock;
  captureException: jest.Mock;
  __scope: { setTag: jest.Mock; setUser: jest.Mock };
};

function httpContext(
  request: Record<string, unknown>,
  response: Record<string, unknown> = {},
  type = 'http',
) {
  return {
    getType: () => type,
    getHandler: () => function handler() {},
    getClass: () => class AlgumController {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

const handlerOf = (value: unknown): CallHandler => ({
  handle: () => of(value),
});
const failing = (error: unknown): CallHandler => ({
  handle: () => throwError(() => error),
});

describe('LoggingInterceptor', () => {
  const metrics = { recordRequest: jest.fn() };
  const interceptor = new LoggingInterceptor(
    metrics as unknown as MetricsService,
  );

  beforeEach(() => metrics.recordRequest.mockClear());

  it('grava a métrica pelo padrão da rota, não pela URL', async () => {
    const request = {
      method: 'GET',
      url: '/api/works/abc',
      route: { path: '/api/works/:id' },
      headers: {},
      user: { sub: 'u1' },
    };

    await lastValueFrom(
      interceptor.intercept(
        httpContext(request, { statusCode: 200 }),
        handlerOf('ok'),
      ),
    );

    expect(metrics.recordRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        route: '/api/works/:id',
        statusCode: 200,
      }),
    );
  });

  // Sem rota casada (404) a URL vira rótulo — sem ids concretos.
  it('sem rota casada, troca os ids da URL por :id', async () => {
    const request = {
      method: 'GET',
      url: '/api/works/68600fb6df23f271f94bb803/x?y=1',
      headers: {},
    };

    await lastValueFrom(
      interceptor.intercept(
        httpContext(request, { statusCode: 404 }),
        handlerOf('ok'),
      ),
    );

    expect(metrics.recordRequest.mock.calls[0][0].route).toBe(
      '/api/works/:id/x',
    );
  });

  it('erro HTTP usa o status dele; erro qualquer é 500 com o tipo', async () => {
    const request = { method: 'POST', url: '/x', headers: {} };

    await expect(
      lastValueFrom(
        interceptor.intercept(
          httpContext(request),
          failing(new HttpException('x', 403)),
        ),
      ),
    ).rejects.toBeDefined();
    expect(metrics.recordRequest.mock.calls[0][0]).toMatchObject({
      statusCode: 403,
      errorType: 'HttpException',
    });

    await expect(
      lastValueFrom(
        interceptor.intercept(httpContext(request), failing('texto')),
      ),
    ).rejects.toBe('texto');
    expect(metrics.recordRequest.mock.calls[1][0]).toMatchObject({
      statusCode: 500,
      errorType: 'UnknownError',
    });
  });

  it('fora de HTTP não mede', async () => {
    await lastValueFrom(
      interceptor.intercept(httpContext({}, {}, 'ws'), handlerOf('ok')),
    );
    expect(metrics.recordRequest).not.toHaveBeenCalled();
  });
});

describe('AuditInterceptor', () => {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const withOptions = (options: unknown) =>
    new AuditInterceptor(
      {
        getAllAndOverride: jest.fn().mockReturnValue(options),
      } as unknown as Reflector,
      audit as unknown as AuditService,
    );
  const request = {
    user: { sub: 'u1', role: 'ADMIN' },
    params: { id: 'x1' },
    headers: {
      'x-forwarded-for': '9.9.9.9, 10.0.0.1',
      'user-agent': 'UA',
      'x-request-id': 'r1',
    },
  };

  beforeEach(() => audit.record.mockClear());

  it('rota sem @Audited não grava', async () => {
    await lastValueFrom(
      withOptions(undefined).intercept(httpContext(request), handlerOf('ok')),
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('sucesso grava quem, o quê, qual e de onde', async () => {
    await lastValueFrom(
      withOptions({
        action: 'x.update',
        entityType: 'x',
        entityIdParam: 'id',
      }).intercept(httpContext(request), handlerOf('ok')),
    );

    expect(audit.record).toHaveBeenCalledWith({
      actorId: 'u1',
      actorRole: 'ADMIN',
      action: 'x.update',
      entityType: 'x',
      entityId: 'x1',
      ipAddress: '9.9.9.9',
      userAgent: 'UA',
      requestId: 'r1',
      success: true,
    });
  });

  it('falha também é registrada, e o erro segue', async () => {
    await expect(
      lastValueFrom(
        withOptions({ action: 'x.delete', entityType: 'x' }).intercept(
          httpContext({ headers: {}, ip: '1.1.1.1' }),
          failing(new Error('boom')),
        ),
      ),
    ).rejects.toThrow('boom');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        ipAddress: '1.1.1.1',
        entityId: undefined,
        metadata: { error: 'Error' },
      }),
    );

    await expect(
      lastValueFrom(
        withOptions({ action: 'a', entityType: 'b' }).intercept(
          httpContext({ headers: {} }),
          failing('x'),
        ),
      ),
    ).rejects.toBe('x');
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ metadata: { error: 'UnknownError' } }),
    );
  });
});

describe('TimeoutInterceptor', () => {
  const interceptor = new TimeoutInterceptor();

  it('rotas longas (scrapers, cron) não têm teto', async () => {
    await expect(
      lastValueFrom(
        interceptor.intercept(
          httpContext({ path: '/api/cron/check' }),
          handlerOf('ok'),
        ),
      ),
    ).resolves.toBe('ok');
  });

  it('estourou o teto: 408', async () => {
    jest.useFakeTimers();
    const pending = lastValueFrom(
      interceptor.intercept(httpContext({ path: '/api/works' }), {
        handle: () => NEVER,
      }),
    );
    jest.advanceTimersByTime(30_001);
    await expect(pending).rejects.toBeInstanceOf(RequestTimeoutException);
    jest.useRealTimers();
  });

  it('erro que não é de tempo passa como está; fora de HTTP nem mede', async () => {
    await expect(
      lastValueFrom(
        interceptor.intercept(
          httpContext({ path: '/x' }),
          failing(new Error('outro')),
        ),
      ),
    ).rejects.toThrow('outro');
    await expect(
      lastValueFrom(
        interceptor.intercept(httpContext({}, {}, 'rpc'), handlerOf(1)),
      ),
    ).resolves.toBe(1);
  });
});

describe('AppThrottlerGuard', () => {
  const tracker = (req: unknown) =>
    (
      AppThrottlerGuard.prototype as unknown as {
        getTracker: (r: unknown) => Promise<string>;
      }
    ).getTracker.call(Object.create(AppThrottlerGuard.prototype), req);

  it('logado conta por usuário; anônimo pelo IP real', async () => {
    await expect(tracker({ user: { sub: 'u1' }, headers: {} })).resolves.toBe(
      'user:u1',
    );
    await expect(
      tracker({ headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' } }),
    ).resolves.toBe('ip:9.9.9.9');
    await expect(
      tracker({ headers: { 'x-forwarded-for': ['8.8.8.8, 1.1.1.1'] } }),
    ).resolves.toBe('ip:8.8.8.8');
    await expect(tracker({ headers: {}, ip: '2.2.2.2' })).resolves.toBe(
      'ip:2.2.2.2',
    );
    await expect(tracker({})).resolves.toBe('ip:unknown');
  });
});

describe('ApiKeyGuard', () => {
  const guardWith = (key?: string) =>
    new ApiKeyGuard({
      get: jest.fn().mockReturnValue(key),
    } as unknown as ConfigService);
  const ctx = (apiKey?: string) =>
    httpContext({ headers: apiKey ? { 'x-api-key': apiKey } : {} });

  it('chave certa passa; errada ou ausente é 401', () => {
    expect(guardWith('segredo').canActivate(ctx('segredo'))).toBe(true);
    expect(() => guardWith('segredo').canActivate(ctx('outro'))).toThrow(
      UnauthorizedException,
    );
    expect(() => guardWith('segredo').canActivate(ctx())).toThrow(
      UnauthorizedException,
    );
  });

  it('servidor sem chave configurada recusa tudo', () => {
    expect(() => guardWith(undefined).canActivate(ctx('qualquer'))).toThrow(
      'API Key não configurada',
    );
  });
});

describe('TextIndexService', () => {
  const originalSkip = process.env.SKIP_TEXT_INDEX_BOOTSTRAP;
  afterEach(() => {
    process.env.SKIP_TEXT_INDEX_BOOTSTRAP = originalSkip;
  });

  it('cria os três índices, com pesos, em português', async () => {
    const prisma = { $runCommandRaw: jest.fn().mockResolvedValue({ ok: 1 }) };
    const service = new TextIndexService(prisma as unknown as PrismaService);

    const reports = await service.ensureAll();

    expect(reports.every((report) => report.ready)).toBe(true);
    expect(prisma.$runCommandRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        createIndexes: 'Work',
        indexes: [
          expect.objectContaining({
            default_language: 'portuguese',
            weights: { title: 10, opOrCatalog: 4, subtitle: 2 },
          }),
        ],
      }),
    );
    expect(service.hasTextIndex('Composer')).toBe(true);
  });

  it('índice já existente é reaproveitado; outra falha deixa a busca no regex', async () => {
    const prisma = {
      $runCommandRaw: jest
        .fn()
        .mockRejectedValueOnce(new Error('IndexOptionsConflict'))
        .mockRejectedValueOnce(new Error('sem permissão'))
        .mockResolvedValueOnce({ ok: 1 }),
    };
    const service = new TextIndexService(prisma as unknown as PrismaService);

    const reports = await service.ensureAll();

    expect(reports.map((report) => report.ready)).toEqual([true, false, true]);
    expect(reports[1].error).toBe('sem permissão');
    expect(service.hasTextIndex('Composer')).toBe(false);
  });

  it('na subida cria; com a variável de pular, não', async () => {
    const prisma = { $runCommandRaw: jest.fn().mockResolvedValue({ ok: 1 }) };
    const service = new TextIndexService(prisma as unknown as PrismaService);

    process.env.SKIP_TEXT_INDEX_BOOTSTRAP = 'true';
    await service.onApplicationBootstrap();
    expect(prisma.$runCommandRaw).not.toHaveBeenCalled();

    process.env.SKIP_TEXT_INDEX_BOOTSTRAP = 'false';
    await service.onApplicationBootstrap();
    expect(prisma.$runCommandRaw).toHaveBeenCalledTimes(3);
  });
});

describe('JobStatusService', () => {
  const job = (overrides: Record<string, unknown> = {}) => ({
    id: 'j1',
    name: 'scraper.run',
    data: {
      idempotencyKey: 'k',
      requestedBy: 'admin',
      requestedAt: '2026-09-13T00:00:00Z',
      payload: {},
    },
    progress: { percent: 50, message: 'metade' },
    attemptsMade: 1,
    processedOn: 1_700_000_000_000,
    finishedOn: 1_700_000_100_000,
    returnvalue: { ok: true },
    failedReason: undefined,
    getState: jest.fn().mockResolvedValue('completed'),
    ...overrides,
  });
  const queue = {
    getJob: jest.fn(),
    getFailed: jest.fn(),
    getJobCounts: jest.fn().mockResolvedValue({ waiting: 2, active: 1 }),
    isPaused: jest.fn().mockResolvedValue(false),
    getWorkers: jest.fn().mockResolvedValue([]),
    getWaiting: jest
      .fn()
      .mockResolvedValue([{ timestamp: Date.now() - 90_000 }]),
  };
  const moduleRef = { get: jest.fn().mockReturnValue(queue) };
  const service = new JobStatusService(moduleRef as unknown as ModuleRef);

  it('descreve o job com quem pediu, progresso e resultado', async () => {
    queue.getJob.mockResolvedValue(job());

    await expect(service.describe('scraper', 'j1')).resolves.toMatchObject({
      state: 'completed',
      requestedBy: 'admin',
      result: { ok: true },
      processedAt: new Date(1_700_000_000_000),
      failedReason: null,
    });
  });

  it('job sem envelope, em andamento, sem datas; job inexistente', async () => {
    queue.getJob.mockResolvedValue(
      job({
        id: undefined,
        data: 'antigo',
        getState: jest.fn().mockResolvedValue('active'),
        processedOn: 0,
        finishedOn: 0,
      }),
    );
    await expect(service.describe('scraper', 'j9')).resolves.toMatchObject({
      jobId: 'j9',
      requestedBy: null,
      result: null,
      processedAt: null,
      finishedAt: null,
    });

    queue.getJob.mockResolvedValue(undefined);
    await expect(service.describe('scraper', 'x')).resolves.toBeNull();
  });

  // Zero workers numa fila é o alarme: jobs entram e nada sai.
  it('saúde das filas: contagens, workers e o atraso do mais antigo', async () => {
    const health = await service.health();

    expect(health[0]).toMatchObject({
      paused: false,
      workers: 0,
      counts: { waiting: 2, active: 1, delayed: 0, completed: 0, failed: 0 },
    });
    expect(health[0].oldestWaitingSeconds).toBeGreaterThanOrEqual(89);
    expect(moduleRef.get).toHaveBeenCalledTimes(health.length);
  });

  it('fila vazia não tem atraso; falhas recentes', async () => {
    queue.getWaiting.mockResolvedValue([]);
    const [first] = await service.health();
    expect(first.oldestWaitingSeconds).toBeNull();

    queue.getFailed.mockResolvedValue([
      job({ failedReason: 'timeout', data: null, finishedOn: 0 }),
    ]);
    await expect(service.failures('scraper', 5)).resolves.toEqual([
      {
        jobId: 'j1',
        job: 'scraper.run',
        attemptsMade: 1,
        failedReason: 'timeout',
        requestedBy: null,
        failedAt: null,
      },
    ]);
    expect(queue.getFailed).toHaveBeenCalledWith(0, 4);
  });
});

describe('SentryService', () => {
  const configWith = (values: Record<string, unknown>) =>
    ({
      get: jest.fn(
        (key: string, fallback?: unknown) => values[key] ?? fallback,
      ),
    }) as unknown as ConfigService;

  beforeEach(() => jest.clearAllMocks());

  it('sem DSN fica desligado e não envia nada', () => {
    const service = new SentryService(configWith({}));
    service.onModuleInit();
    service.captureException(new Error('x'));

    expect(service.isEnabled()).toBe(false);
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('com DSN inicializa sem dados pessoais e marca a rota, o status e o usuário', () => {
    const service = new SentryService(
      configWith({
        'observability.sentryDsn': 'https://k@sentry/1',
        'observability.release': 'abc',
      }),
    );
    service.onModuleInit();

    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ sendDefaultPii: false, release: 'abc' }),
    );

    service.captureException(new Error('x'), {
      requestId: 'r1',
      method: 'GET',
      path: '/x',
      statusCode: 500,
      userId: 'u1',
    });
    expect(sentry.__scope.setTag).toHaveBeenCalledWith('route', 'GET /x');
    expect(sentry.__scope.setUser).toHaveBeenCalledWith({ id: 'u1' });

    sentry.__scope.setTag.mockClear();
    service.captureException(new Error('y'));
    expect(sentry.__scope.setTag).not.toHaveBeenCalled();
    expect(sentry.captureException).toHaveBeenCalledTimes(2);
  });
});

describe('StorageCleanupService', () => {
  const stale = [
    { id: 'a1', publicId: 'p1', resourceType: 'image' },
    { id: 'a2', publicId: 'p2', resourceType: 'raw' },
    { id: 'a3', publicId: 'p3', resourceType: 'image' },
  ];
  let prisma: { storedAsset: { findMany: jest.Mock; update: jest.Mock } };
  let cloudinary: { getAsset: jest.Mock; deleteAsset: jest.Mock };
  let service: StorageCleanupService;

  beforeEach(() => {
    prisma = {
      storedAsset: {
        findMany: jest.fn().mockResolvedValue(stale),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    cloudinary = {
      getAsset: jest
        .fn()
        .mockResolvedValueOnce({ public_id: 'p1' })
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('cloudinary fora')),
      deleteAsset: jest.fn().mockResolvedValue(undefined),
    };
    service = new StorageCleanupService(
      prisma as unknown as PrismaService,
      cloudinary as unknown as CloudinaryService,
    );
  });

  it('apaga do provedor o que foi enviado e abandonado, e marca tudo como removido', async () => {
    await expect(service.cleanupStalePending()).resolves.toEqual({
      pendingExamined: 3,
      uploadedButAbandoned: 1,
      neverUploaded: 1,
      failures: 1,
    });
    expect(cloudinary.deleteAsset).toHaveBeenCalledWith('p1', 'image');
    expect(prisma.storedAsset.update).toHaveBeenCalledTimes(2);
  });

  it('simulação só conta', async () => {
    await service.cleanupStalePending(true);

    expect(cloudinary.deleteAsset).not.toHaveBeenCalled();
    expect(prisma.storedAsset.update).not.toHaveBeenCalled();
  });

  it('nada pendente, nada a fazer', async () => {
    prisma.storedAsset.findMany.mockResolvedValue([]);

    await expect(service.cleanupStalePending()).resolves.toMatchObject({
      pendingExamined: 0,
    });
  });
});
