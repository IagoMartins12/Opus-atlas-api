import { UnrecoverableError } from 'bullmq';
import {
  JOB_BLOG_PUBLISH_SCHEDULED,
  JOB_MAINTENANCE_RUN,
  JOB_MODERATION_SLA_SWEEP,
  JOB_NEWSLETTER_BATCH,
  JOB_NEWSLETTER_PLAN,
  JOB_NOTIFICATIONS_SWEEP,
  JOB_SCRAPER_RUN,
} from '../common/queue/queue.constants';
import { MaintenanceProcessor } from './maintenance.processor';
import { NewsletterProcessor } from './newsletter.processor';
import { NotificationsProcessor } from './notifications.processor';
import { ScraperProcessor } from './scraper.processor';

// Os ids reais mudam com o catálogo; aqui só importa a decisão "conhecido ou não".
jest.mock('../scrapers/scraper-registry', () => ({
  isScraperId: (id: unknown) => id === 'scraper-ok',
}));
jest.mock('../admin/maintenance/maintenance-catalog', () => ({
  isMaintenanceTaskId: (id: unknown) => id === 'tarefa-ok',
}));

const job = (
  name: string,
  payload: unknown = {},
  requestedBy: string | null = 'admin',
) => ({
  id: 'j1',
  name,
  attemptsMade: 1,
  data: { payload, requestedBy },
  updateProgress: jest.fn().mockResolvedValue(undefined),
  log: jest.fn().mockResolvedValue(undefined),
});

describe('NotificationsProcessor', () => {
  const sweep = { sweep: jest.fn().mockResolvedValue('notificações') };
  const moderation = { sweep: jest.fn().mockResolvedValue('moderação') };
  const publishing = { publishDue: jest.fn().mockResolvedValue('blog') };
  const queue = { upsertSchedule: jest.fn().mockResolvedValue(undefined) };
  const processor = new NotificationsProcessor(
    sweep as never,
    moderation as never,
    publishing as never,
    queue as never,
  );

  it('reafirma os três agendamentos na subida', async () => {
    await processor.onApplicationBootstrap();

    expect(
      queue.upsertSchedule.mock.calls.map(([s]) => [s.schedulerId, s.cron]),
    ).toEqual([
      ['notifications:sweep', '*/5 * * * *'],
      ['moderation:sla-sweep', '0 * * * *'],
      ['blog:publish-scheduled', '* * * * *'],
    ]);
  });

  it('cada job vai ao seu serviço; desconhecido não é tentado de novo', async () => {
    await expect(
      processor.process(job(JOB_NOTIFICATIONS_SWEEP) as never),
    ).resolves.toBe('notificações');
    await expect(
      processor.process(job(JOB_MODERATION_SLA_SWEEP) as never),
    ).resolves.toBe('moderação');
    await expect(
      processor.process(job(JOB_BLOG_PUBLISH_SCHEDULED) as never),
    ).resolves.toBe('blog');
    await expect(
      processor.process(job('velho') as never),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(() =>
      processor.onFailed(job('x') as never, new Error('falhou')),
    ).not.toThrow();
  });
});

describe('NewsletterProcessor', () => {
  const dispatch = {
    plan: jest.fn().mockResolvedValue({ batches: 2 }),
    sendBatch: jest.fn().mockResolvedValue({ sent: 48, failed: 2 }),
  };
  const processor = new NewsletterProcessor(dispatch as never);

  it('planeja com quem pediu', async () => {
    await processor.process(
      job(JOB_NEWSLETTER_PLAN, { campaignId: 'c1' }) as never,
    );

    expect(dispatch.plan).toHaveBeenCalledWith('c1', 'admin');
  });

  it('envia o lote e informa o progresso', async () => {
    const batch = job(JOB_NEWSLETTER_BATCH, {
      campaignId: 'c1',
      subscriberIds: ['s1'],
    });

    await expect(processor.process(batch as never)).resolves.toEqual({
      sent: 48,
      failed: 2,
    });
    expect(dispatch.sendBatch).toHaveBeenCalledWith('c1', ['s1']);
    expect(batch.updateProgress).toHaveBeenCalled();
  });

  it('progresso que falha não derruba o lote; job desconhecido é irrecuperável', async () => {
    const batch = job(JOB_NEWSLETTER_BATCH, {
      campaignId: 'c1',
      subscriberIds: [],
    });
    batch.updateProgress.mockRejectedValue(new Error('redis'));

    await expect(processor.process(batch as never)).resolves.toBeDefined();
    await expect(processor.process(job('x') as never)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    expect(() =>
      processor.onFailed(job('x') as never, new Error('e')),
    ).not.toThrow();
    expect(() => processor.onCompleted(job('x') as never)).not.toThrow();
  });
});

describe('ScraperProcessor', () => {
  const runner = {
    run: jest.fn((_id: string, onProgress: (p: number, m: string) => void) => {
      onProgress(50, 'metade');
      return Promise.resolve({ imported: 3 });
    }),
  };
  const processor = new ScraperProcessor(runner as never);

  it('roda o scraper conhecido e repassa o progresso com a frase', async () => {
    const run = job(JOB_SCRAPER_RUN, { scraperId: 'scraper-ok' });

    await expect(processor.process(run as never)).resolves.toEqual({
      imported: 3,
    });
    expect(run.log).toHaveBeenCalledWith('50% — metade');
  });

  it('job ou scraper desconhecido é irrecuperável', async () => {
    await expect(processor.process(job('x') as never)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    await expect(
      processor.process(
        job(JOB_SCRAPER_RUN, { scraperId: 'removido' }) as never,
      ),
    ).rejects.toThrow('Scraper desconhecido: removido');

    expect(() =>
      processor.onFailed(
        job(JOB_SCRAPER_RUN, { scraperId: 's' }) as never,
        new Error('e'),
      ),
    ).not.toThrow();
    expect(() =>
      processor.onFailed(
        { name: 'x', data: undefined } as never,
        new Error('e'),
      ),
    ).not.toThrow();
  });
});

describe('MaintenanceProcessor', () => {
  const tasks = { run: jest.fn().mockResolvedValue({ removed: 5 }) };
  const processor = new MaintenanceProcessor(tasks as never);

  it('roda a tarefa conhecida com as opções', async () => {
    await expect(
      processor.process(
        job(JOB_MAINTENANCE_RUN, {
          taskId: 'tarefa-ok',
          dryRun: true,
          retentionDays: 30,
        }) as never,
      ),
    ).resolves.toEqual({ removed: 5 });
    expect(tasks.run).toHaveBeenCalledWith('tarefa-ok', {
      dryRun: true,
      retentionDays: 30,
    });
  });

  it('job ou tarefa desconhecida é irrecuperável', async () => {
    await expect(processor.process(job('x') as never)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    await expect(
      processor.process(job(JOB_MAINTENANCE_RUN, { taskId: 'sumiu' }) as never),
    ).rejects.toThrow('Tarefa de manutenção desconhecida: sumiu');

    expect(() =>
      processor.onFailed(
        job(JOB_MAINTENANCE_RUN, { taskId: 't' }) as never,
        new Error('e'),
      ),
    ).not.toThrow();
    expect(() =>
      processor.onFailed(
        { name: 'x', data: undefined } as never,
        new Error('e'),
      ),
    ).not.toThrow();
  });
});
