import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppCacheService } from '../../common/cache/cache.service';
import { QueueService } from '../../common/queue/queue.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogJobsService } from './catalog-jobs.service';

const work = jest.fn();
jest.mock('../../catalog/jobs/catalog-jobs', () => {
  const actual = jest.requireActual('../../catalog/jobs/catalog-jobs');
  return {
    ...actual,
    findCatalogJob: (id: string) => ({
      ...actual.findCatalogJob(id),
      work: (...a: unknown[]) => work(...a),
    }),
  };
});

const run = (over: Record<string, unknown> = {}) => ({
  id: 'run-1',
  job: 'fix-epochs',
  jobName: 'Corrigir épocas dos compositores',
  status: 'queued',
  apply: false,
  args: {},
  requestedBy: 'u1',
  stopRequested: false,
  progressDone: 0,
  progressTotal: null,
  progressMessage: null,
  log: [],
  summary: null,
  sample: [],
  warnings: [],
  error: null,
  queuedAt: new Date(),
  startedAt: null,
  finishedAt: null,
  heartbeatAt: null,
  ...over,
});

describe('CatalogJobsService', () => {
  let service: CatalogJobsService;
  let prisma: {
    catalogJobRun: Record<string, jest.Mock>;
  };
  let queue: { enqueue: jest.Mock };
  let cache: { invalidateMany: jest.Mock };

  beforeEach(async () => {
    prisma = {
      catalogJobRun: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(run()),
        create: jest.fn().mockResolvedValue(run()),
        update: jest.fn().mockResolvedValue(run({ stopRequested: false })),
      },
    };
    queue = { enqueue: jest.fn().mockResolvedValue({}) };
    cache = { invalidateMany: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        CatalogJobsService,
        { provide: PrismaService, useValue: prisma },
        { provide: QueueService, useValue: queue },
        { provide: AppCacheService, useValue: cache },
      ],
    }).compile();
    service = module.get(CatalogJobsService);
  });

  describe('start', () => {
    it('cria a execução e enfileira', async () => {
      await service.start('fix-epochs', { apply: false }, 'u1');

      expect(prisma.catalogJobRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          job: 'fix-epochs',
          status: 'queued',
          apply: false,
        }),
      });
      expect(queue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          queue: 'catalog',
          payload: { runId: 'run-1' },
        }),
      );
    });

    it('recusa rotina que não existe', async () => {
      await expect(
        service.start('apaga-tudo', { apply: true }, 'u1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('rotina destrutiva só grava com confirmação', async () => {
      await expect(
        service.start('merge-duplicate-composers', { apply: true }, 'u1'),
      ).rejects.toBeInstanceOf(BadRequestException);

      // Simular não pede confirmação.
      await service.start('merge-duplicate-composers', { apply: false }, 'u1');
      await service.start(
        'merge-duplicate-composers',
        { apply: true, confirm: true },
        'u1',
      );
      expect(queue.enqueue).toHaveBeenCalledTimes(2);
    });

    it('não dispara com outra rotina em andamento', async () => {
      prisma.catalogJobRun.findFirst.mockResolvedValue(
        run({ status: 'running' }),
      );

      await expect(
        service.start('fix-epochs', { apply: false }, 'u1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.catalogJobRun.create).not.toHaveBeenCalled();
    });

    it('só repassa os parâmetros que a rotina declara', async () => {
      await service.start('fix-epochs', { apply: false, limit: 5 }, 'u1');
      expect(prisma.catalogJobRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ args: {} }),
      });

      await service.start(
        'fix-editions',
        { apply: false, limit: 5, pause: 800 },
        'u1',
      );
      expect(prisma.catalogJobRun.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ args: { limit: 5, pause: 800 } }),
      });
    });

    it('marca como falha se não conseguir enfileirar', async () => {
      queue.enqueue.mockRejectedValue(new Error('redis fora'));

      await expect(
        service.start('fix-epochs', { apply: false }, 'u1'),
      ).rejects.toThrow('redis fora');
      expect(prisma.catalogJobRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'failed' }),
        }),
      );
    });
  });

  describe('stop', () => {
    it('pede a parada de uma execução ativa', async () => {
      prisma.catalogJobRun.findUnique.mockResolvedValue(
        run({ status: 'running' }),
      );

      await service.stop('run-1');

      expect(prisma.catalogJobRun.update).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        data: { stopRequested: true },
      });
    });

    it('não mexe em execução que já terminou', async () => {
      prisma.catalogJobRun.findUnique.mockResolvedValue(run({ status: 'ok' }));

      await service.stop('run-1');

      expect(prisma.catalogJobRun.update).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('marca como interrompida a execução sem sinal do worker', async () => {
      await service.list();

      expect(prisma.catalogJobRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'running' }),
          data: expect.objectContaining({ status: 'interrupted' }),
        }),
      );
    });

    it('devolve todas as rotinas, com a ativa e a última', async () => {
      prisma.catalogJobRun.findMany.mockResolvedValue([
        run({ id: 'a', job: 'fix-epochs', status: 'running' }),
        run({ id: 'b', job: 'fix-difficulty', status: 'ok' }),
      ]);

      const list = await service.list();

      expect(list.find((j) => j.id === 'fix-epochs')?.active?.id).toBe('a');
      expect(list.find((j) => j.id === 'fix-difficulty')?.last?.id).toBe('b');
      expect(list.length).toBe(15);
    });
  });

  describe('execute', () => {
    const finalData = () => {
      const calls = prisma.catalogJobRun.update.mock.calls;
      return calls[calls.length - 1][0].data;
    };

    beforeEach(() => {
      work.mockReset();
      prisma.catalogJobRun.update.mockResolvedValue({ stopRequested: false });
    });

    it('roda a rotina, fecha como concluída e guarda o resumo', async () => {
      work.mockResolvedValue({ summary: { corrigidos: 3 }, sample: ['a'] });

      await service.execute('run-1');

      expect(work).toHaveBeenCalledWith(
        expect.objectContaining({ apply: false }),
      );
      expect(finalData()).toEqual(
        expect.objectContaining({
          status: 'ok',
          summary: { corrigidos: 3 },
          sample: ['a'],
        }),
      );
      // Simulação não limpa o cache do catálogo.
      expect(cache.invalidateMany).not.toHaveBeenCalled();
    });

    it('limpa o cache do catálogo só quando grava', async () => {
      prisma.catalogJobRun.findUnique.mockResolvedValue(run({ apply: true }));
      work.mockResolvedValue(undefined);

      await service.execute('run-1');

      expect(cache.invalidateMany).toHaveBeenCalled();
    });

    it('fecha como falha com o motivo, sem lançar', async () => {
      work.mockRejectedValue(new Error('IMSLP fora'));

      await expect(service.execute('run-1')).resolves.toBeUndefined();

      expect(finalData()).toEqual(
        expect.objectContaining({ status: 'failed', error: 'IMSLP fora' }),
      );
    });

    it('execução parada antes de começar não roda', async () => {
      prisma.catalogJobRun.findUnique.mockResolvedValue(
        run({ stopRequested: true }),
      );

      await service.execute('run-1');

      expect(work).not.toHaveBeenCalled();
      expect(finalData()).toEqual(
        expect.objectContaining({ status: 'stopped' }),
      );
    });

    it('ignora execução que não está na fila', async () => {
      prisma.catalogJobRun.findUnique.mockResolvedValue(
        run({ status: 'running' }),
      );

      await service.execute('run-1');

      expect(work).not.toHaveBeenCalled();
    });
  });
});
