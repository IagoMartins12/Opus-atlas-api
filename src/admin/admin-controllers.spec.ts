import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';
import { QUEUE_NAMES } from '../common/queue/queue.constants';
import { AdminAdsController } from './ads/admin-ads.controller';
import { AdminBillingController } from './billing/admin-billing.controller';
import { AdminCatalogController } from './catalog/admin-catalog.controller';
import { AdminDatabaseController } from './database/admin-database.controller';
import { AdminMaintenanceController } from './maintenance/admin-maintenance.controller';
import { MAINTENANCE_TASK_IDS } from './maintenance/maintenance-catalog';
import { AdminMetricsController } from './metrics/admin-metrics.controller';
import { AdminNewsletterController } from './newsletter/admin-newsletter.controller';
import { AdminTemplatesController } from './newsletter/admin-templates.controller';
import { EmailEventsController } from './newsletter/events/email-events.controller';
import { AdminJobsController } from './operations/admin-jobs.controller';
import { AdminOperationsController } from './operations/admin-operations.controller';
import { AdminReportsController } from './reports/admin-reports.controller';

const admin: AccessTokenPayload = {
  sub: 'a1',
  email: 'admin@x.com',
  role: 2,
  isTeacher: false,
  isStudent: false,
  type: 'access',
};

function echoMock(...methods: string[]): Record<string, jest.Mock> {
  return Object.fromEntries(
    methods.map((m) => [m, jest.fn().mockResolvedValue(m)]),
  );
}
const as = <T>(value: unknown) => value as T;
const response = () =>
  ({ setHeader: jest.fn() }) as unknown as Response & { setHeader: jest.Mock };

describe('AdminAdsController', () => {
  const service = echoMock(
    'list',
    'overview',
    'checkConflict',
    'findOne',
    'create',
    'update',
    'clone',
    'attachMedia',
    'removeMedia',
    'remove',
  );
  const controller = new AdminAdsController(as(service));

  it('repassa; remover mídia é imagem salvo quando pedem vídeo', async () => {
    await controller.list({} as never);
    await controller.overview();
    await controller.checkConflict({} as never);
    await controller.findOne('ad1');
    await controller.create(admin, {} as never);
    await controller.update(admin, 'ad1', {} as never);
    await controller.clone(admin, 'ad1', {} as never);
    await controller.attachMedia(admin, 'ad1', {} as never);
    await controller.removeMedia(admin, 'ad1', 'video');
    await controller.removeMedia(admin, 'ad1');
    await controller.remove('ad1');

    expect(service.removeMedia.mock.calls.map(([, , kind]) => kind)).toEqual([
      'video',
      'image',
    ]);
    expect(service.create).toHaveBeenCalledWith('a1', {});
  });
});

describe('AdminBillingController e AdminCatalogController', () => {
  it('cupons e preços', async () => {
    const service = echoMock(
      'listCoupons',
      'createCoupon',
      'updateCoupon',
      'toggleCoupon',
      'deleteCoupon',
      'listPricing',
      'pricingHistory',
      'setPricing',
    );
    const controller = new AdminBillingController(as(service));

    await controller.listCoupons({} as never);
    await controller.createCoupon({} as never);
    await controller.updateCoupon('c1', {} as never);
    await controller.toggleCoupon('c1');
    await controller.deleteCoupon('c1');
    await controller.listPricing();
    await controller.pricingHistory('PLUS');
    await controller.setPricing({} as never);

    expect(service.pricingHistory).toHaveBeenCalledWith('PLUS');
  });

  it('catálogo e métricas', async () => {
    const service = echoMock(
      'listComposers',
      'updateComposer',
      'verifyComposersInBulk',
      'deleteComposer',
      'listWorks',
      'updateWork',
      'deleteWork',
      'listScores',
      'updateScore',
    );
    const metrics = echoMock('overview', 'mostAnnotatedWorks', 'byEpoch');
    const controller = new AdminCatalogController(as(service), as(metrics));

    await controller.listComposers({} as never);
    await controller.updateComposer(admin, 'c1', {} as never);
    await controller.verifyComposersBulk(admin, {
      composerIds: ['c1'],
      isVerified: true,
      notes: 'ok',
    } as never);
    await controller.deleteComposer('c1');
    await controller.listWorks({} as never);
    await controller.updateWork(admin, 'w1', {} as never);
    await controller.deleteWork('w1');
    await controller.listScores({} as never);
    await controller.updateScore('s1', {} as never);
    await controller.overview();
    await controller.mostAnnotated();
    await controller.byEpoch();

    expect(service.verifyComposersInBulk).toHaveBeenCalledWith(
      'a1',
      ['c1'],
      true,
      'ok',
    );
    expect(metrics.byEpoch).toHaveBeenCalled();
  });
});

describe('AdminDatabaseController', () => {
  const service = echoMock(
    'listModels',
    'describeModel',
    'listRecords',
    'createRecord',
    'updateRecord',
    'deleteRecords',
  );
  const exportRecords = jest.fn();
  const controller = new AdminDatabaseController(
    as({ ...service, exportRecords }),
  );

  it('listagem com padrões de página e ordem', async () => {
    await controller.models();
    await controller.describe({ model: 'User' } as never);
    await controller.records({ model: 'User' } as never);

    expect(service.listRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'User',
        page: 1,
        pageSize: 25,
        sortDirection: 'desc',
      }),
    );
  });

  it('exportação em CSV vira anexo; em JSON volta como está', async () => {
    const res = response();

    exportRecords.mockResolvedValue('a,b');
    await expect(
      controller.export({ model: 'User', format: 'csv' } as never, res),
    ).resolves.toBe('a,b');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="User.csv"',
    );

    exportRecords.mockResolvedValue([{ id: 1 }]);
    const jsonRes = response();
    await expect(
      controller.export({ model: 'User' } as never, jsonRes),
    ).resolves.toEqual([{ id: 1 }]);
    expect(exportRecords).toHaveBeenLastCalledWith(
      expect.objectContaining({ format: 'json' }),
    );
    expect(jsonRes.setHeader).not.toHaveBeenCalled();
  });

  it('escrita leva quem fez e a confirmação', async () => {
    await controller.create(
      { model: 'User', data: {}, confirmation: 'x' } as never,
      admin,
    );
    await controller.update(
      'User',
      'u1',
      { data: {}, confirmation: 'x' } as never,
      admin,
    );
    await controller.remove(
      { model: 'User', ids: ['u1'], confirmation: 'x' } as never,
      admin,
    );

    expect(service.deleteRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        ids: ['u1'],
        actor: { actorId: 'a1', actorRole: '2' },
      }),
    );
  });
});

describe('AdminMaintenanceController', () => {
  const task = MAINTENANCE_TASK_IDS[0];
  const maintenance: Record<string, jest.Mock> = {
    ...echoMock(
      'listTasks',
      'recentFailures',
      'runTask',
      'listSchedules',
      'setSchedule',
    ),
    removeSchedule: jest.fn().mockResolvedValue(true),
  };
  const health = echoMock('snapshot');
  const controller = new AdminMaintenanceController(
    as(maintenance),
    as(health),
  );

  it('tarefas, saúde e falhas', async () => {
    await controller.tasks();
    await controller.systemHealth();
    await controller.failures({} as never);
    expect(maintenance.recentFailures).toHaveBeenCalledWith(20);
  });

  it('rodar e agendar exigem tarefa conhecida; confirmação padrão é falsa', async () => {
    await controller.run(task, {} as never, admin);
    expect(maintenance.runTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: task,
        confirm: false,
        requestedBy: 'a1',
      }),
    );

    await controller.setSchedule(
      task,
      { cron: '0 3 * * *', confirm: true } as never,
      admin,
    );
    expect(maintenance.setSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ cron: '0 3 * * *', confirm: true }),
    );

    // `run` é assíncrono: a tarefa desconhecida chega como promessa rejeitada.
    await expect(
      controller.run('inventada', {} as never, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('remover agendamento: existente ou 404', async () => {
    await controller.schedules();
    await expect(controller.removeSchedule(task)).resolves.toEqual({
      taskId: task,
      removed: true,
    });

    maintenance.removeSchedule.mockResolvedValue(false);
    await expect(controller.removeSchedule(task)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('newsletter no painel', () => {
  it('campanhas e assinantes; exportação em CSV com BOM', async () => {
    const service: Record<string, jest.Mock> = {
      ...echoMock(
        'listCampaigns',
        'findCampaign',
        'createCampaign',
        'updateCampaign',
        'queueCampaign',
        'sendTest',
        'cancelCampaign',
        'deleteCampaign',
        'listSubscribers',
        'updateSubscriber',
        'removeSubscriber',
        'stats',
      ),
      exportSubscribers: jest.fn(),
    };
    const controller = new AdminNewsletterController(as(service));

    await controller.listCampaigns({} as never);
    await controller.findCampaign('c1');
    await controller.createCampaign({} as never);
    await controller.updateCampaign('c1', {} as never);
    await controller.queueCampaign('c1', admin);
    await controller.sendTest('c1', {} as never);
    await controller.cancelCampaign('c1');
    await controller.deleteCampaign('c1');
    await controller.listSubscribers({} as never);
    await controller.updateSubscriber('s1', {} as never);
    await controller.removeSubscriber('s1', {} as never);
    await controller.stats();
    expect(service.queueCampaign).toHaveBeenCalledWith('c1', 'a1');

    service.exportSubscribers.mockResolvedValue({ total: 0 });
    await expect(
      controller.exportSubscribers({} as never, response()),
    ).resolves.toEqual({ total: 0 });

    service.exportSubscribers.mockResolvedValue({ csv: 'email' });
    await expect(
      controller.exportSubscribers({} as never, response()),
    ).resolves.toBe('﻿email');
  });

  it('modelos, listas de teste e análise', async () => {
    const service = {
      ...echoMock(
        'listTemplates',
        'findTemplate',
        'analyzeTemplate',
        'createTemplate',
        'updateTemplate',
        'bulkDeleteTemplates',
        'listTestLists',
        'createTestList',
        'updateTestList',
        'deleteTestList',
        'analytics',
      ),
      exportAnalytics: jest.fn(),
    };
    const controller = new AdminTemplatesController(as(service));

    await controller.listTemplates({} as never);
    await controller.findTemplate('t1');
    await controller.analyze('t1');
    await controller.createTemplate({} as never);
    await controller.updateTemplate('t1', {} as never);
    await controller.bulkDelete({} as never);
    await controller.listTestLists();
    await controller.createTestList({} as never);
    await controller.updateTestList('l1', {} as never);
    await controller.deleteTestList('l1');
    await controller.analytics({} as never);

    service.exportAnalytics.mockResolvedValue({ campaigns: [] });
    await expect(
      controller.exportAnalytics({} as never, response()),
    ).resolves.toEqual({ campaigns: [] });
    service.exportAnalytics.mockResolvedValue({ csv: 'x' });
    await expect(
      controller.exportAnalytics({} as never, response()),
    ).resolves.toBe('﻿x');
  });
});

describe('EmailEventsController', () => {
  const events = { ingest: jest.fn() };
  const controllerWith = (secret?: string) =>
    new EmailEventsController(as(events), {
      get: jest.fn().mockReturnValue(secret),
    } as unknown as ConfigService);
  const req = (rawBody?: Buffer) => ({ rawBody, body: {} }) as never;

  // Sem segredo, não há como distinguir o provedor de um estranho.
  it('sem segredo configurado recusa tudo', async () => {
    await expect(
      controllerWith(undefined).handle(
        req(Buffer.from('{}')),
        'id',
        'ts',
        'sig',
      ),
    ).rejects.toThrow('não configurado');
  });

  it('cabeçalhos ausentes, corpo cru ausente e assinatura inválida são 400', async () => {
    const controller = controllerWith('whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw');

    await expect(
      controller.handle(req(Buffer.from('{}')), undefined, 'ts', 'sig'),
    ).rejects.toThrow('ausente');
    await expect(
      controller.handle(
        req(),
        'id',
        String(Math.floor(Date.now() / 1000)),
        'v1,abc',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.handle(
        req(Buffer.from('{}')),
        'id',
        String(Math.floor(Date.now() / 1000)),
        'v1,abc',
      ),
    ).rejects.toThrow('Assinatura inválida');
    expect(events.ingest).not.toHaveBeenCalled();
  });
});

describe('AdminJobsController', () => {
  const queue = QUEUE_NAMES[0];
  const status = {
    health: jest.fn().mockResolvedValue([]),
    failures: jest.fn().mockResolvedValue([]),
    describe: jest.fn(),
  };
  const queueService = {
    listSchedules: jest.fn().mockResolvedValue([]),
    cancel: jest.fn(),
  };
  const controller = new AdminJobsController(as(status), as(queueService));

  it('filas, falhas e agendamentos', async () => {
    await expect(controller.queues()).resolves.toEqual({ queues: [] });
    await expect(controller.failures(queue, {} as never)).resolves.toEqual({
      queue,
      failures: [],
    });
    expect(status.failures).toHaveBeenCalledWith(queue, 20);
    await expect(controller.schedules(queue)).resolves.toEqual({
      queue,
      schedules: [],
    });
  });

  it('fila desconhecida é 400; job inexistente ou não cancelável é 404', async () => {
    await expect(controller.schedules('fila-x')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    status.describe.mockResolvedValue(null);
    await expect(controller.job(queue, 'j1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    status.describe.mockResolvedValue({ jobId: 'j1' });
    await expect(controller.job(queue, 'j1')).resolves.toEqual({ jobId: 'j1' });

    queueService.cancel.mockResolvedValue(false);
    await expect(controller.cancel(queue, 'j1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    queueService.cancel.mockResolvedValue(true);
    await expect(controller.cancel(queue, 'j1')).resolves.toEqual({
      queue,
      jobId: 'j1',
      cancelled: true,
    });
  });
});

describe('auditoria, métricas e relatórios', () => {
  it('auditoria: lista, resumo e exportação', async () => {
    const audit = { ...echoMock('list', 'summary'), export: jest.fn() };
    const controller = new AdminOperationsController(as(audit));

    await controller.list({} as never);
    await controller.summary({} as never);
    audit.export.mockResolvedValue({ items: [] });
    await expect(controller.export({} as never, response())).resolves.toEqual({
      items: [],
    });
    audit.export.mockResolvedValue({ csv: 'a' });
    await expect(controller.export({} as never, response())).resolves.toBe(
      '﻿a',
    );
  });

  it('métricas', async () => {
    const service = echoMock('overview', 'insights');
    const controller = new AdminMetricsController(as(service));

    await controller.overview();
    await controller.insights({ areas: ['catalog'] } as never);
    expect(service.insights).toHaveBeenCalledWith(['catalog']);
  });

  it('relatórios em CSV: nome do arquivo limpo, BOM no corpo', async () => {
    const service: Record<string, jest.Mock> = {
      ...echoMock('list', 'generate', 'remove'),
      download: jest
        .fn()
        .mockResolvedValue({ filename: 'users overview/1.csv', csv: 'a,b' }),
    };
    const controller = new AdminReportsController(as(service));
    const res = response();

    await controller.list(admin);
    await controller.generate(admin, {
      type: 'users-overview',
      period: '30d',
    } as never);
    await expect(controller.download(admin, 'r1', res)).resolves.toBe('﻿a,b');
    await controller.remove(admin, 'r1');

    expect(service.generate).toHaveBeenCalledWith(
      'a1',
      'users-overview',
      '30d',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="users_overview_1.csv"',
    );
  });
});
