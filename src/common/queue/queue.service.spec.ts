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
