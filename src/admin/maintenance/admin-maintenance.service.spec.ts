import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { QueueService } from '../../common/queue/queue.service';
import { JobStatusService } from '../../common/queue/job-status.service';
import { AdminMaintenanceService } from './admin-maintenance.service';

describe('AdminMaintenanceService', () => {
  let service: AdminMaintenanceService;
  let queue: {
    enqueue: jest.Mock;
    upsertSchedule: jest.Mock;
    listSchedules: jest.Mock;
    removeSchedule: jest.Mock;
  };

  beforeEach(async () => {
    queue = {
      enqueue: jest.fn().mockResolvedValue({ jobId: 'job-1' }),
      upsertSchedule: jest.fn().mockResolvedValue(undefined),
      listSchedules: jest.fn().mockResolvedValue([]),
      removeSchedule: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminMaintenanceService,
        { provide: QueueService, useValue: queue },
        { provide: JobStatusService, useValue: { failures: jest.fn() } },
      ],
    }).compile();

    service = module.get(AdminMaintenanceService);
  });

  describe('listTasks', () => {
    it('devolve o catálogo com o agendamento de cada tarefa', async () => {
      queue.listSchedules.mockResolvedValue([
        {
          schedulerId: 'maintenance:tokens.prune',
          cron: '30 4 * * *',
          timezone: 'America/Sao_Paulo',
          nextRunAt: new Date('2026-09-09T07:30:00.000Z'),
        },
      ]);

      const { tasks } = await service.listTasks();
      const tokens = tasks.find((task) => task.id === 'tokens.prune');
      const audit = tasks.find((task) => task.id === 'audit.prune');

      expect(tokens?.schedule?.cron).toBe('30 4 * * *');
      expect(audit?.schedule).toBeNull();
    });
  });

  describe('runTask', () => {
    // As três tarefas de expurgo apagam dado que não volta.
    it('tarefa destrutiva sem confirmação vira simulação', async () => {
      const result = await service.runTask({
        taskId: 'tokens.prune',
        confirm: false,
        requestedBy: 'admin-1',
      });

      expect(result.dryRun).toBe(true);
      expect(queue.enqueue.mock.calls[0][0].payload.dryRun).toBe(true);
      expect(result).toHaveProperty('aviso');
    });

    it('com confirmação, aplica', async () => {
      const result = await service.runTask({
        taskId: 'tokens.prune',
        confirm: true,
        requestedBy: 'admin-1',
      });

      expect(result.dryRun).toBe(false);
      expect(result).not.toHaveProperty('aviso');
    });

    // Ela não apaga nada; exigir confirmação seria cerimônia vazia.
    it('tarefa não destrutiva roda sem confirmação', async () => {
      const result = await service.runTask({
        taskId: 'storage.orphan-sweep',
        confirm: false,
        requestedBy: 'admin-1',
      });

      expect(result.dryRun).toBe(false);
    });

    it('simulação e aplicação são jobs diferentes', async () => {
      await service.runTask({
        taskId: 'tokens.prune',
        confirm: false,
        requestedBy: null,
      });
      await service.runTask({
        taskId: 'tokens.prune',
        confirm: true,
        requestedBy: null,
      });

      const [primeira, segunda] = queue.enqueue.mock.calls.map(
        (call) => call[0].idempotencyKey,
      );

      expect(primeira).not.toBe(segunda);
      expect(primeira).toContain('simulacao');
      expect(segunda).toContain('aplicando');
    });

    it('leva a retenção pedida para o job', async () => {
      await service.runTask({
        taskId: 'audit.prune',
        confirm: true,
        retentionDays: 90,
        requestedBy: null,
      });

      expect(queue.enqueue.mock.calls[0][0].payload.retentionDays).toBe(90);
    });

    it('registra quem pediu', async () => {
      await service.runTask({
        taskId: 'search.reindex',
        confirm: false,
        requestedBy: 'admin-9',
      });

      expect(queue.enqueue.mock.calls[0][0].requestedBy).toBe('admin-9');
    });
  });

  describe('setSchedule', () => {
    it('deriva o id do agendador da tarefa, então salvar de novo substitui', async () => {
      await service.setSchedule({
        taskId: 'storage.cleanup-pending',
        cron: '0 4 * * *',
        confirm: true,
        requestedBy: null,
      });

      expect(queue.upsertSchedule.mock.calls[0][0].schedulerId).toBe(
        'maintenance:storage.cleanup-pending',
      );
    });

    it('agenda no fuso de São Paulo', async () => {
      await service.setSchedule({
        taskId: 'storage.orphan-sweep',
        cron: '0 5 * * 0',
        confirm: false,
        requestedBy: null,
      });

      expect(queue.upsertSchedule.mock.calls[0][0].timezone).toBe(
        'America/Sao_Paulo',
      );
    });

    // Sem `confirm`, toda execução agendada rodaria em simulação — o que não é
    // agendamento nenhum, e o administrador só descobriria depois.
    it('recusa agendar tarefa destrutiva sem confirmação', async () => {
      await expect(
        service.setSchedule({
          taskId: 'audit.prune',
          cron: '0 3 * * *',
          confirm: false,
          requestedBy: null,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(queue.upsertSchedule).not.toHaveBeenCalled();
    });

    it('execução agendada sempre aplica', async () => {
      await service.setSchedule({
        taskId: 'tokens.prune',
        cron: '30 4 * * *',
        confirm: true,
        requestedBy: null,
      });

      expect(queue.upsertSchedule.mock.calls[0][0].payload.dryRun).toBe(false);
    });

    it('recusa cron com número de campos errado', async () => {
      await expect(
        service.setSchedule({
          taskId: 'search.reindex',
          cron: '0 4 * *',
          confirm: true,
          requestedBy: null,
        }),
      ).rejects.toThrow(/cinco campos|5 campos/);
    });

    it('recusa tarefa desconhecida antes de tocar na fila', async () => {
      await expect(
        service.setSchedule({
          taskId: 'database-cleanup' as never,
          cron: '0 4 * * *',
          confirm: true,
          requestedBy: null,
        }),
      ).rejects.toThrow(/desconhecida/);
    });
  });

  describe('removeSchedule', () => {
    it('remove pelo id derivado da tarefa', async () => {
      await service.removeSchedule('tokens.prune');

      expect(queue.removeSchedule).toHaveBeenCalledWith(
        'maintenance',
        'maintenance:tokens.prune',
      );
    });
  });
});
