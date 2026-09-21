import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportService } from '../../scrapers/import/import.service';
import { ScraperRegistry } from '../../scrapers/scraper-registry';
import { CalendarImportService } from './calendar-import.service';

describe('CalendarImportService', () => {
  let prisma: { event: { findMany: jest.Mock } };
  let importer: { importEvents: jest.Mock };
  let registry: { isRegistered: jest.Mock };
  let service: CalendarImportService;

  beforeEach(() => {
    prisma = { event: { findMany: jest.fn().mockResolvedValue([]) } };
    importer = {
      importEvents: jest.fn().mockResolvedValue({
        success: true,
        message: '1 importado',
        imported: 1,
        failed: 1,
        duplicates: 1,
        details: [
          {
            eventId: 'e1',
            externalId: 'a',
            title: 'A',
            status: 'success',
            message: 'ok',
          },
          {
            externalId: 'b',
            title: 'B',
            status: 'duplicate',
            message: 'já existe',
          },
          {
            externalId: 'c',
            title: 'C',
            status: 'error',
            message: 'data inválida',
          },
        ],
      }),
    };
    registry = { isRegistered: jest.fn().mockReturnValue(true) };
    service = new CalendarImportService(
      prisma as unknown as PrismaService,
      importer as unknown as ImportService,
      registry as unknown as ScraperRegistry,
    );
  });

  it('marca os que já existem e desmarca a seleção deles', async () => {
    prisma.event.findMany.mockResolvedValue([
      { id: 'e9', externalId: 'osesp-1', slug: 'x' },
    ]);

    const result = await service.checkDuplicates([
      { externalId: 'osesp-1', title: 'A' },
      { externalId: 'osesp-2', title: 'B' },
    ]);

    expect(result.events[0]).toMatchObject({
      alreadyExists: true,
      selected: false,
      existingEventId: 'e9',
    });
    expect(result.events[1]).toMatchObject({
      alreadyExists: false,
      selected: true,
    });
    expect(result).toMatchObject({ duplicates: 1, new: 1 });
  });

  // Id vazio casaria com qualquer evento sem id.
  it('ignora externalId vazio na consulta', async () => {
    await service.checkDuplicates([{ externalId: '' }, { title: 'sem id' }]);

    expect(prisma.event.findMany).not.toHaveBeenCalled();
  });

  it('scraper desconhecido é 400, sem importar nada', async () => {
    registry.isRegistered.mockReturnValue(false);

    await expect(service.bulkInsert('nao-existe', [])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(importer.importEvents).not.toHaveBeenCalled();
  });

  // O legado conhecia a casa de duas das sete e caía com 500 no meio.
  it('importa pela mesma importação dos scrapers e responde no formato do modal', async () => {
    const result = await service.bulkInsert('sala-cecilia-meireles', [
      {
        title: ' A ',
        slug: 'a',
        type: 'CONCERT',
        startDate: '2026-09-11T22:00:00.000Z',
        externalId: ' a ',
        selected: true,
      },
    ]);

    const [scraperId, events] = importer.importEvents.mock.calls[0];
    expect(scraperId).toBe('sala-cecilia-meireles');
    expect(events[0]).toMatchObject({
      title: 'A',
      externalId: 'a',
      startDate: new Date('2026-09-11T22:00:00.000Z'),
      composerNames: [],
    });
    expect(events[0]).not.toHaveProperty('selected');
    expect(result.results).toEqual([
      {
        success: true,
        eventId: 'e1',
        title: 'A',
        isDuplicate: false,
        error: undefined,
      },
      {
        success: false,
        eventId: undefined,
        title: 'B',
        isDuplicate: true,
        error: undefined,
      },
      {
        success: false,
        eventId: undefined,
        title: 'C',
        isDuplicate: false,
        error: 'data inválida',
      },
    ]);
  });
});
