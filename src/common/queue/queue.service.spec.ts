import { Test, TestingModule } from '@nestjs/testing';
import { ModuleRef } from '@nestjs/core';
import { QueueService } from './queue.service';
import { QUEUE_NEWSLETTER } from './queue.constants';

describe('QueueService', () => {
  let service: QueueService;
  let queue: {
    add: jest.Mock;
    getJob: jest.Mock;
  };

  beforeEach(async () => {
    queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      getJob: jest.fn(),
    };
    queue.getJob.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        { provide: ModuleRef, useValue: { get: () => queue } },
      ],
    }).compile();

    service = module.get(QueueService);
  });

  const input = {
    queue: QUEUE_NEWSLETTER,
    job: 'newsletter.campaign.plan',
    idempotencyKey: 'newsletter.plan.campanha-1',
    payload: { campaignId: 'campanha-1' },
  } as const;

  it('usa a chave de idempotência como `jobId`', async () => {
    await service.enqueue({ ...input });

    expect(queue.add.mock.calls[0][2].jobId).toBe('newsletter.plan.campanha-1');
  });

  it('envelopa a carga com autor e horário', async () => {
    await service.enqueue({ ...input, requestedBy: 'admin-1' });

    const body = queue.add.mock.calls[0][1];

    expect(body.payload).toEqual({ campaignId: 'campanha-1' });
    expect(body.requestedBy).toBe('admin-1');
    expect(body.idempotencyKey).toBe('newsletter.plan.campanha-1');
  });

  // Dois cliques no botão de disparar não podem virar dois envios.
  it('não enfileira de novo quando a chave já existe', async () => {
    queue.getJob.mockResolvedValue({ id: 'newsletter.plan.campanha-1' });

    const result = await service.enqueue({ ...input });

    expect(queue.add).not.toHaveBeenCalled();
    expect(result.alreadyQueued).toBe(true);
    expect(result.jobId).toBe('newsletter.plan.campanha-1');
  });

  it('aplica os padrões de tentativa e retenção', async () => {
    await service.enqueue({ ...input });

    const options = queue.add.mock.calls[0][2];

    expect(options.attempts).toBe(3);
    expect(options.backoff).toEqual({ type: 'exponential', delay: 5_000 });
    expect(options.removeOnComplete).toEqual({ age: 604_800, count: 1_000 });
  });

  it('deixa o produtor sobrescrever tentativas', async () => {
    await service.enqueue({ ...input, options: { attempts: 1 } });

    expect(queue.add.mock.calls[0][2].attempts).toBe(1);
  });

  describe('cancel', () => {
    it('remove job que ainda espera', async () => {
      const job = {
        getState: jest.fn().mockResolvedValue('waiting'),
        remove: jest.fn(),
      };
      queue.getJob.mockResolvedValue(job);

      expect(await service.cancel(QUEUE_NEWSLETTER, 'job-1')).toBe(true);
      expect(job.remove).toHaveBeenCalled();
    });

    // Interromper no meio deixaria efeito pela metade.
    it('recusa cancelar job em execução', async () => {
      const job = {
        getState: jest.fn().mockResolvedValue('active'),
        remove: jest.fn(),
      };
      queue.getJob.mockResolvedValue(job);

      expect(await service.cancel(QUEUE_NEWSLETTER, 'job-1')).toBe(false);
      expect(job.remove).not.toHaveBeenCalled();
    });

    it('devolve falso quando o job não existe', async () => {
      queue.getJob.mockResolvedValue(null);

      expect(await service.cancel(QUEUE_NEWSLETTER, 'sumiu')).toBe(false);
    });
  });
});

describe('QueueService — agendamentos guardados no banco', () => {
  const fila = {
    upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
    removeJobScheduler: jest.fn().mockResolvedValue(true),
    getJobSchedulers: jest.fn().mockResolvedValue([]),
  };
  const prisma = {
    taskSchedule: {
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const service = new QueueService({
    get: (token: unknown) =>
      typeof token === 'function' && token.name === 'PrismaService'
        ? prisma
        : fila,
  } as never);
  const agendamento = {
    queue: 'maintenance' as const,
    schedulerId: 'maintenance:tokens.prune',
    cron: '30 4 * * *',
    timezone: 'America/Sao_Paulo',
    job: 'maintenance.task.run',
    payload: { taskId: 'tokens.prune' },
  };

  beforeEach(() => jest.clearAllMocks());

  it('agendar grava no Redis e no banco, ligado', async () => {
    await service.upsertSchedule(agendamento);

    expect(fila.upsertJobScheduler).toHaveBeenCalled();
    expect(prisma.taskSchedule.upsert.mock.calls[0][0].create).toMatchObject({
      schedulerId: 'maintenance:tokens.prune',
      enabled: true,
    });
  });

  // É o que impede o worker de recriá-lo ao subir.
  it('remover deixa o registro desligado', async () => {
    await service.removeSchedule('maintenance', 'maintenance:tokens.prune');

    expect(prisma.taskSchedule.updateMany).toHaveBeenCalledWith({
      where: { schedulerId: 'maintenance:tokens.prune' },
      data: { enabled: false },
    });
  });

  it('o padrão só entra quando nunca existiu', async () => {
    prisma.taskSchedule.findUnique.mockResolvedValueOnce({ id: 'x' });
    await expect(service.agendarSeNuncaExistiu(agendamento)).resolves.toBe(
      false,
    );
    expect(fila.upsertJobScheduler).not.toHaveBeenCalled();

    await expect(service.agendarSeNuncaExistiu(agendamento)).resolves.toBe(
      true,
    );
    expect(fila.upsertJobScheduler).toHaveBeenCalled();
  });

  it('ao subir: traz para o banco o que só estava no Redis e reaplica os ligados', async () => {
    fila.getJobSchedulers.mockResolvedValueOnce([
      {
        key: 'maintenance:database.backup',
        name: 'maintenance.task.run',
        pattern: '0 3 * * *',
        tz: 'America/Sao_Paulo',
        template: { data: { payload: { taskId: 'database.backup' } } },
      },
    ]);
    prisma.taskSchedule.findMany.mockResolvedValueOnce([
      { ...agendamento, requestedBy: null, options: null },
    ]);

    const n = await service.reaplicarAgendamentos(['maintenance']);

    expect(prisma.taskSchedule.create.mock.calls[0][0].data).toMatchObject({
      schedulerId: 'maintenance:database.backup',
      payload: { taskId: 'database.backup' },
    });
    expect(n).toBe(1);
    // Reaplicar não regrava o banco.
    expect(prisma.taskSchedule.upsert).not.toHaveBeenCalled();
  });
});
