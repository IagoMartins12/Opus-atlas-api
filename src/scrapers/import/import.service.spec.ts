import { AppCacheService } from '../../common/cache/cache.service';
import { EventType } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ScraperRegistry } from '../scraper-registry';
import { ImportService } from './import.service';
import { ScrapedEvent } from '../../common/interfaces/scraped-event.interface';

const evento = (overrides: Partial<ScrapedEvent> = {}): ScrapedEvent => ({
  title: 'Concerto de Ano Novo',
  slug: 'concerto-de-ano-novo',
  description: 'Orquestra e coro',
  type: EventType.CONCERT,
  startDate: new Date('2027-01-01T22:00:00Z'),
  startTime: '19:00',
  venueDetails: 'Sala principal',
  ticketUrl: null,
  externalUrl: null,
  ticketInfo: null,
  externalId: 'casa-1',
  imageUrl: null,
  composerNames: [],
  performers: [],
  program: null,
  ...overrides,
});

describe('ImportService', () => {
  let service: ImportService;
  let prisma: {
    event: { findFirst: jest.Mock; findUnique: jest.Mock; create: jest.Mock };
    venue: { upsert: jest.Mock };
    composer: { findFirst: jest.Mock };
    scrapingLog: { create: jest.Mock };
  };
  let registry: { require: jest.Mock; isRegistered: jest.Mock };

  const config = {
    venueName: 'Sala Cecília Meireles',
    venueSlug: 'sala-cecilia-meireles',
    baseUrl: 'https://salaceciliameireles.rj.gov.br',
    venue: {
      address: 'Largo da Lapa, 47 - Centro',
      city: 'Rio de Janeiro',
      state: 'RJ',
      country: 'Brasil',
      zipCode: '20021-180',
    },
  };

  beforeEach(async () => {
    prisma = {
      event: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'evento-1' }),
      },
      venue: { upsert: jest.fn().mockResolvedValue({ id: 'casa-1' }) },
      composer: { findFirst: jest.fn().mockResolvedValue(null) },
      scrapingLog: { create: jest.fn().mockResolvedValue({}) },
    };

    registry = {
      require: jest.fn().mockReturnValue({ getConfig: () => config }),
      isRegistered: jest.fn().mockReturnValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScraperRegistry, useValue: registry },
        { provide: AppCacheService, useValue: { invalidateMany: jest.fn() } },
      ],
    }).compile();

    service = module.get(ImportService);
  });

  const importar = (events: ScrapedEvent[], id = 'sala-cecilia-meireles') =>
    service.importEvents(id, events);

  it('grava o evento com a casa resolvida', async () => {
    const result = await importar([evento()]);

    expect(result.imported).toBe(1);
    expect(prisma.event.create.mock.calls[0][0].data).toMatchObject({
      title: 'Concerto de Ano Novo',
      venueId: 'casa-1',
      source: 'SCRAPER',
      status: 'PUBLISHED',
    });
  });

  describe('a casa de espetáculo', () => {
    // O importador tinha um mapa próprio com **duas das sete** casas, e a
    // falta estourava antes do laço: a rodada inteira falhava com "Venue não
    // configurado". Agora os dados vêm da configuração do próprio scraper.
    it('vem da configuração do scraper, não de um mapa paralelo', async () => {
      await importar([evento()]);

      expect(registry.require).toHaveBeenCalledWith('sala-cecilia-meireles');
      expect(prisma.venue.upsert.mock.calls[0][0]).toMatchObject({
        where: { slug: 'sala-cecilia-meireles' },
        create: {
          name: 'Sala Cecília Meireles',
          city: 'Rio de Janeiro',
          website: 'https://salaceciliameireles.rj.gov.br',
        },
      });
    });

    // Endereço e descrição podem ter sido corrigidos à mão no painel.
    it('não sobrescreve a casa que já existe', async () => {
      await importar([evento()]);

      expect(prisma.venue.upsert.mock.calls[0][0].update).toEqual({});
    });

    // Resolver dentro do laço seria uma consulta por evento.
    it('resolve a casa uma vez para a rodada inteira', async () => {
      await importar([evento(), evento({ externalId: 'b', slug: 'b' })]);

      expect(prisma.venue.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('duplicatas', () => {
    it('evento já existente não entra de novo', async () => {
      prisma.event.findFirst.mockResolvedValue({ id: 'antigo' });

      const result = await importar([evento()]);

      expect(result.imported).toBe(0);
      expect(result.duplicates).toBe(1);
      expect(prisma.event.create).not.toHaveBeenCalled();
    });

    // Um `externalId` vazio no `OR` casaria com qualquer evento cujo campo
    // também esteja vazio, e a rodada inteira sairia marcada como duplicata.
    it('sem `externalId`, compara por título e data', async () => {
      await importar([evento({ externalId: '' })]);

      const or = prisma.event.findFirst.mock.calls[0][0].where.OR;

      expect(or).toHaveLength(1);
      expect(or[0].AND[0]).toEqual({ title: 'Concerto de Ano Novo' });
    });
  });

  describe('horário', () => {
    // A Cidade das Artes publica temporada, não sessão: "Wicked, 15/07 a
    // 04/10" não tem um horário só. O campo era obrigatório e os 19 eventos
    // dela eram recusados um a um.
    it('evento sem horário entra com o campo nulo', async () => {
      const result = await importar([evento({ startTime: null })]);

      expect(result.imported).toBe(1);
      expect(prisma.event.create.mock.calls[0][0].data.startTime).toBeNull();
    });

    it('não inventa horário', async () => {
      await importar([evento({ startTime: null })]);

      expect(prisma.event.create.mock.calls[0][0].data.startTime).not.toBe(
        '00:00',
      );
    });
  });

  describe('slug', () => {
    it('acrescenta sufixo quando o slug já existe', async () => {
      prisma.event.findUnique
        .mockResolvedValueOnce({ id: 'outro' })
        .mockResolvedValue(null);

      await importar([evento()]);

      expect(prisma.event.create.mock.calls[0][0].data.slug).toBe(
        'concerto-de-ano-novo-1',
      );
    });
  });

  describe('falhas', () => {
    it('um evento que falha não derruba os outros', async () => {
      prisma.event.create
        .mockRejectedValueOnce(new Error('banco fora'))
        .mockResolvedValue({ id: 'evento-2' });

      const result = await importar([
        evento(),
        evento({ externalId: 'b', slug: 'b' }),
      ]);

      expect(result.imported).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.details[0]).toMatchObject({ status: 'error' });
    });

    it('lote vazio não cria casa nem log', async () => {
      const result = await importar([]);

      expect(result.success).toBe(false);
      expect(prisma.venue.upsert).not.toHaveBeenCalled();
    });
  });

  describe('registro da rodada', () => {
    it('grava o log de scraping com os números', async () => {
      await importar([evento()]);

      expect(prisma.scrapingLog.create.mock.calls[0][0].data).toMatchObject({
        source: 'sala-cecilia-meireles',
        status: 'success',
        eventsFound: 1,
        eventsCreated: 1,
      });
    });

    // O log é registro, não parte da importação: perdê-lo não pode desfazer o
    // que já entrou.
    it('falha ao gravar o log não derruba a importação', async () => {
      prisma.scrapingLog.create.mockRejectedValue(new Error('sem tabela'));

      await expect(importar([evento()])).resolves.toMatchObject({
        imported: 1,
      });
    });
  });

  describe('compositores', () => {
    it('casa o compositor citado no evento', async () => {
      prisma.composer.findFirst.mockResolvedValue({ id: 'comp-1' });

      await importar([evento({ composerNames: ['Mendelssohn'] })]);

      expect(prisma.event.create.mock.calls[0][0].data.composerIds).toEqual([
        'comp-1',
      ]);
    });

    it('compositor desconhecido não impede o evento', async () => {
      const result = await importar([evento({ composerNames: ['Fulano'] })]);

      expect(result.imported).toBe(1);
      expect(prisma.event.create.mock.calls[0][0].data.composerIds).toEqual([]);
    });
  });
});
