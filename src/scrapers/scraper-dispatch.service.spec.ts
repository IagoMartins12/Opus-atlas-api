import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { QueueService } from '../common/queue/queue.service';
import { ScraperDispatchService } from './scraper-dispatch.service';
import { ScraperRegistry, SCRAPER_IDS } from './scraper-registry';

const conhecido = (id: string) => {
  if (!(SCRAPER_IDS as readonly string[]).includes(id)) {
    throw new BadRequestException(`Scraper desconhecido: "${id}".`);
  }
  return id;
};

const ATIVAS = SCRAPER_IDS.length - 1;

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
      requireId: jest.fn(conhecido),
      // A casa desativada é recusada com o motivo; o resto como `requireId`.
      requireAtivo: jest.fn((id: string) => {
        if (id === 'auditorio-ibirapuera') {
          throw new BadRequestException('Esta casa está desativada: x');
        }
        return conhecido(id);
      }),
      motivoDesativado: jest.fn((id: string) =>
        id === 'auditorio-ibirapuera' ? 'fora do ar' : null,
      ),
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

      expect(key).toMatch(
        /^scraper\.osesp\.previa\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}$/,
      );
    });

    it('registra quem pediu', async () => {
      await service.enqueue('osesp', 'admin-9');

      expect(queue.enqueue.mock.calls[0][0].requestedBy).toBe('admin-9');
    });

    // Rodada pedida à mão só lê: o que entra na agenda é escolhido depois.
    it('leva a casa na carga do job, em modo prévia e com uma tentativa', async () => {
      await service.enqueue('teatro-amazonas', null);

      const [chamada] = queue.enqueue.mock.calls[0];
      expect(chamada.payload).toEqual({
        scraperId: 'teatro-amazonas',
        modo: 'previa',
      });
      expect(chamada.options).toEqual({ attempts: 1 });
    });

    it('casa desativada é recusada com o motivo', async () => {
      await expect(
        service.enqueue('auditorio-ibirapuera', null),
      ).rejects.toThrow('desativada');
      expect(queue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('enqueueAll', () => {
    // O `scrape-all` anterior disparava sete `setImmediate` no processo HTTP.
    it('enfileira uma rodada por casa, sem executar nenhuma', async () => {
      const result = await service.enqueueAll('admin-1');

      // A desativada fica de fora, em vez de falhar na fila.
      expect(result.queued).toBe(ATIVAS);
      expect(queue.enqueue).toHaveBeenCalledTimes(ATIVAS);
    });

    it('cada casa recebe a própria chave', async () => {
      await service.enqueueAll(null);

      const chaves = queue.enqueue.mock.calls.map(
        (call) => call[0].idempotencyKey,
      );

      expect(new Set(chaves).size).toBe(ATIVAS);
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

    // A agendada importa sozinha; a tela mostra o que entrou.
    it('a agendada importa, com uma tentativa', async () => {
      await service.setSchedule({
        scraperId: 'osesp',
        cron: '0 3 * * *',
        requestedBy: null,
      });

      const [chamada] = queue.upsertSchedule.mock.calls[0];
      expect(chamada.payload).toEqual({ scraperId: 'osesp', modo: 'importar' });
      expect(chamada.options).toEqual({ attempts: 1 });
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
