import { Test, TestingModule } from '@nestjs/testing';
import { ImportService } from './import/import.service';
import { ScraperRegistry } from './scraper-registry';
import { ScraperRunService } from './scraper-run.service';

const importResult = (overrides: Record<string, unknown> = {}) => ({
  success: true,
  message: 'ok',
  imported: 0,
  failed: 0,
  duplicates: 0,
  details: [],
  ...overrides,
});

describe('ScraperRunService', () => {
  let service: ScraperRunService;
  let scraper: {
    getConfig: jest.Mock;
    resetState: jest.Mock;
    scrapeEvents: jest.Mock;
  };
  let registry: { require: jest.Mock };
  let importer: { importEvents: jest.Mock };

  beforeEach(async () => {
    scraper = {
      getConfig: jest.fn().mockReturnValue({ venueName: 'OSESP' }),
      resetState: jest.fn(),
      scrapeEvents: jest.fn().mockResolvedValue([]),
    };

    registry = { require: jest.fn().mockReturnValue(scraper) };
    importer = { importEvents: jest.fn().mockResolvedValue(importResult()) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScraperRunService,
        { provide: ScraperRegistry, useValue: registry },
        { provide: ImportService, useValue: importer },
      ],
    }).compile();

    service = module.get(ScraperRunService);
  });

  // O `ImportService` estava registrado no módulo e não era chamado por
  // ninguém: os sete scrapers rodavam e nada era persistido.
  it('entrega os eventos coletados ao importador', async () => {
    const events = [{ title: 'Concerto' }, { title: 'Recital' }];
    scraper.scrapeEvents.mockResolvedValue(events);

    await service.run('osesp');

    expect(importer.importEvents).toHaveBeenCalledWith('osesp', events);
  });

  it('devolve o que foi importado, duplicado e recusado', async () => {
    scraper.scrapeEvents.mockResolvedValue([{}, {}, {}]);
    importer.importEvents.mockResolvedValue(
      importResult({ imported: 1, duplicates: 1, failed: 1 }),
    );

    const result = await service.run('osesp');

    expect(result).toMatchObject({
      scraperId: 'osesp',
      venueName: 'OSESP',
      eventsFound: 3,
      imported: 1,
      duplicates: 1,
      failed: 1,
    });
  });

  // Sem zerar, os erros de ontem aparecem no relatório de hoje: o scraper é um
  // singleton e guarda o estado da rodada em `this`.
  it('zera o estado do scraper antes de começar', async () => {
    const ordem: string[] = [];
    scraper.resetState.mockImplementation(() => ordem.push('reset'));
    scraper.scrapeEvents.mockImplementation(() => {
      ordem.push('scrape');
      return Promise.resolve([]);
    });

    await service.run('osesp');

    expect(ordem).toEqual(['reset', 'scrape']);
  });

  it('explica no resultado o que não entrou', async () => {
    importer.importEvents.mockResolvedValue(
      importResult({
        failed: 1,
        details: [
          {
            externalId: 'x',
            title: 'Concerto sem hora',
            status: 'error',
            message: 'Evento sem horário de início — não importado',
          },
          {
            externalId: 'y',
            title: 'Já existia',
            status: 'duplicate',
            message: 'Evento já existe',
          },
        ],
      }),
    );

    const result = await service.run('osesp');

    // Só o que falhou vira "problema"; duplicata é resultado normal.
    expect(result.problems).toEqual([
      'Concerto sem hora: Evento sem horário de início — não importado',
    ]);
  });

  describe('progresso', () => {
    it('a coleta ocupa os primeiros 80% e a importação fecha em 100%', async () => {
      scraper.scrapeEvents.mockImplementation(
        (onProgress: (c: number, t: number, m: string) => void) => {
          onProgress(50, 100, 'metade');
          return Promise.resolve([]);
        },
      );

      const percentuais: number[] = [];
      await service.run('osesp', (percent) => percentuais.push(percent));

      expect(percentuais).toEqual([0, 40, 80, 100]);
    });

    it('não divide por zero quando o total é desconhecido', async () => {
      scraper.scrapeEvents.mockImplementation(
        (onProgress: (c: number, t: number, m: string) => void) => {
          onProgress(0, 0, 'sem total');
          return Promise.resolve([]);
        },
      );

      const percentuais: number[] = [];
      await service.run('osesp', (percent) => percentuais.push(percent));

      expect(percentuais.every((value) => Number.isFinite(value))).toBe(true);
    });
  });
});
