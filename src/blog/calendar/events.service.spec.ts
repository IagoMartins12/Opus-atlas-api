import { AppCacheService } from '../../common/cache/cache.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from './events.service';

const EVENT = '6a0000000000000000000011';
const VENUE = '6a0000000000000000000022';
const USER = '690273c1ecac0fb66b3844bb';

function makePrisma() {
  return {
    event: {
      findUnique: jest.fn().mockResolvedValue({
        id: EVENT,
        status: 'PUBLISHED',
        publishedAt: null,
        isVerified: false,
        startDate: new Date('2026-09-11T22:00:00Z'),
      }),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: EVENT, ...data }),
      ),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: EVENT, ...data }),
      ),
      delete: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    venue: {
      findUnique: jest.fn().mockResolvedValue({ id: VENUE }),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: VENUE, ...data }),
      ),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: VENUE, ...data }),
      ),
      delete: jest.fn().mockResolvedValue({}),
    },
  };
}

const base = {
  title: 'Concerto de Primavera',
  type: 'CONCERT' as const,
  venueId: VENUE,
  startDate: '2026-09-11T22:00:00.000Z',
};

describe('EventsService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: EventsService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new EventsService(
      prisma as unknown as PrismaService,
      {
        get: jest.fn().mockResolvedValue(undefined),
        set: jest.fn(),
        invalidateMany: jest.fn(),
      } as unknown as AppCacheService,
    );
  });

  const eventData = () => prisma.event.create.mock.calls[0][0].data;

  describe('criar evento', () => {
    it('nasce pendente, com slug do título e origem de administrador', async () => {
      await service.createEvent(base, USER);

      expect(eventData()).toMatchObject({
        slug: 'concerto-de-primavera',
        status: 'PENDING',
        source: 'ADMIN',
        submittedBy: USER,
        publishedAt: null,
      });
    });

    it('slug já usado ganha contador', async () => {
      prisma.event.findMany.mockResolvedValue([
        { slug: 'concerto-de-primavera' },
        { slug: 'concerto-de-primavera-1' },
      ]);

      await service.createEvent(base, USER);

      expect(eventData().slug).toBe('concerto-de-primavera-2');
    });

    // O legado gravava verifiedBy mesmo sem verificar.
    it('só registra quem verificou quando o evento é verificado', async () => {
      await service.createEvent(base, USER);
      expect(eventData()).not.toHaveProperty('verifiedBy');

      await service.createEvent({ ...base, isVerified: true }, USER);
      expect(prisma.event.create.mock.calls[1][0].data.verifiedBy).toBe(USER);
    });

    it('publicado já nasce com data de publicação', async () => {
      await service.createEvent({ ...base, status: 'PUBLISHED' }, USER);

      expect(eventData().publishedAt).toBeInstanceOf(Date);
    });

    it('local inexistente é 404', async () => {
      prisma.venue.findUnique.mockResolvedValue(null);

      await expect(service.createEvent(base, USER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('recusa ingresso com endereço perigoso', async () => {
      await expect(
        service.createEvent(
          { ...base, ticketUrl: 'javascript:alert(1)' },
          USER,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('recusa fim antes do início', async () => {
      await expect(
        service.createEvent(
          { ...base, endDate: '2026-09-01T00:00:00.000Z' },
          USER,
        ),
      ).rejects.toThrow(/anterior/);
    });

    it('normaliza o horário "19h30"', async () => {
      await service.createEvent({ ...base, startTime: '19h30' }, USER);

      expect(eventData().startTime).toBe('19:30');
    });
  });

  describe('editar evento', () => {
    // O legado repassava o corpo ao Prisma.
    it('só os campos do evento chegam ao banco', async () => {
      await service.updateEvent(
        EVENT,
        { title: ' Novo ', viewCount: 9999, source: 'USER' } as never,
        USER,
      );

      expect(prisma.event.update.mock.calls[0][0].data).toEqual({
        title: 'Novo',
      });
    });

    it('publicar pela primeira vez grava a data', async () => {
      await service.updateEvent(EVENT, { status: 'PUBLISHED' }, USER);

      expect(
        prisma.event.update.mock.calls[0][0].data.publishedAt,
      ).toBeInstanceOf(Date);
    });

    it('verificar registra quem e quando', async () => {
      await service.updateEvent(EVENT, { isVerified: true }, USER);

      expect(prisma.event.update.mock.calls[0][0].data).toMatchObject({
        isVerified: true,
        verifiedBy: USER,
      });
    });
  });

  it('evento fora do ar é 404 para o público, visível para administrador', async () => {
    prisma.event.findUnique.mockResolvedValue({ id: EVENT, status: 'DRAFT' });

    await expect(service.getEvent(EVENT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.getEvent(EVENT, { role: 2 })).resolves.toMatchObject({
      success: true,
    });
  });

  describe('locais', () => {
    it('cria com slug do nome e país padrão', async () => {
      await service.createVenue({
        name: 'Sala São Paulo',
        city: 'São Paulo',
        state: 'SP',
      });

      expect(prisma.venue.create.mock.calls[0][0].data).toMatchObject({
        slug: 'sala-sao-paulo',
        country: 'Brasil',
      });
    });

    // O slug é a chave da importação dos scrapers.
    it('a edição não muda o slug nem aceita campo de fora', async () => {
      await service.updateVenue(VENUE, {
        name: 'Sala SP',
        slug: 'outro',
        events: { deleteMany: {} },
      } as never);

      expect(prisma.venue.update.mock.calls[0][0].data).toEqual({
        name: 'Sala SP',
      });
    });

    it('não apaga local com eventos', async () => {
      prisma.event.count.mockResolvedValue(3);

      await expect(service.deleteVenue(VENUE)).rejects.toThrow(/3 evento/);
      expect(prisma.venue.delete).not.toHaveBeenCalled();
    });
  });
});
