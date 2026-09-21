import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { QueueService } from '../common/queue/queue.service';
import { ScraperDispatchService } from './scraper-dispatch.service';
import { ScraperRegistry, SCRAPER_IDS } from './scraper-registry';

describe('ScraperDispatchService', () => {
  let service: ScraperDispatchService;
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

    const registry = {
      require: jest.fn(),
      requireId: jest.fn((id: string) => {
        if (!(SCRAPER_IDS as readonly string[]).includes(id)) {
          throw new BadRequestException(`Scraper desconhecido: "${id}".`);
        }
        return id;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScraperDispatchService,
        { provide: ScraperRegistry, useValue: registry },
        { provide: QueueService, useValue: queue },
      ],
    }).compile();

    service = module.get(ScraperDispatchService);
  });

  describe('enqueue', () => {
    // Clicar duas vezes em "raspar" não pode abrir dois navegadores.
    it('a chave inclui a casa e o minuto', async () => {
      await service.enqueue('osesp', 'admin-1');

      const key = queue.enqueue.mock.calls[0][0].idempotencyKey;

      expect(key).toMatch(/^scraper\.osesp\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}$/);
    });

    it('registra quem pediu', async () => {
      await service.enqueue('osesp', 'admin-9');

      expect(queue.enqueue.mock.calls[0][0].requestedBy).toBe('admin-9');
    });

    it('leva a casa na carga do job', async () => {
      await service.enqueue('teatro-amazonas', null);

      expect(queue.enqueue.mock.calls[0][0].payload).toEqual({
        scraperId: 'teatro-amazonas',
      });
    });
  });

  describe('enqueueAll', () => {
    // O `scrape-all` anterior disparava sete `setImmediate` no processo HTTP.
    it('enfileira uma rodada por casa, sem executar nenhuma', async () => {
      const result = await service.enqueueAll('admin-1');

      expect(result.queued).toBe(SCRAPER_IDS.length);
      expect(queue.enqueue).toHaveBeenCalledTimes(SCRAPER_IDS.length);
    });

    it('cada casa recebe a própria chave', async () => {
      await service.enqueueAll(null);

      const chaves = queue.enqueue.mock.calls.map(
        (call) => call[0].idempotencyKey,
      );

      expect(new Set(chaves).size).toBe(SCRAPER_IDS.length);
    });
  });

  describe('setSchedule', () => {
    it('deriva o id do agendador da casa, então salvar de novo substitui', async () => {
      await service.setSchedule({
        scraperId: 'osesp',
        cron: '0 3 * * *',
        requestedBy: null,
      });

      expect(queue.upsertSchedule.mock.calls[0][0].schedulerId).toBe(
        'scraper:osesp',
      );
    });

    it('agenda no fuso de São Paulo', async () => {
      await service.setSchedule({
        scraperId: 'osesp',
        cron: '0 3 * * *',
        requestedBy: null,
      });

      expect(queue.upsertSchedule.mock.calls[0][0].timezone).toBe(
        'America/Sao_Paulo',
      );
    });

    it('recusa cron com número de campos errado', async () => {
      await expect(
        service.setSchedule({
          scraperId: 'osesp',
          cron: '0 3 * *',
          requestedBy: null,
        }),
      ).rejects.toThrow(/cinco campos|5 campos/);

      expect(queue.upsertSchedule).not.toHaveBeenCalled();
    });

    it('recusa casa desconhecida antes de tocar na fila', async () => {
      await expect(
        service.setSchedule({
          scraperId: 'casa-inventada' as never,
          cron: '0 3 * * *',
          requestedBy: null,
        }),
      ).rejects.toThrow(/desconhecido/);
    });
  });

  describe('removeSchedule', () => {
    it('remove pelo id derivado da casa', async () => {
      await service.removeSchedule('theatro-da-paz');

      expect(queue.removeSchedule).toHaveBeenCalledWith(
        'scraper',
        'scraper:theatro-da-paz',
      );
    });
  });
});
