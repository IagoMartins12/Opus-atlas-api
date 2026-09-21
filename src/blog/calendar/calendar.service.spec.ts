import { AppCacheService } from '../../common/cache/cache.service';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CalendarService } from './calendar.service';

const venue = { id: 'v1', name: 'Theatro da Paz', city: 'Belém', state: 'PA' };

const event = (overrides: Record<string, unknown> = {}) => ({
  id: 'e1',
  slug: 'concerto',
  title: 'Concerto',
  startDate: new Date('2026-09-11T22:00:00Z'),
  startTime: '19:00',
  endDate: null,
  endTime: null,
  duration: null,
  type: 'CONCERT',
  status: 'PUBLISHED',
  venue,
  composerIds: [],
  imageUrl: null,
  description: null,
  program: null,
  ticketUrl: null,
  isFree: false,
  ...overrides,
});

describe('CalendarService', () => {
  let prisma: {
    event: { findMany: jest.Mock };
    venue: { findMany: jest.Mock };
    composer: { findMany: jest.Mock };
  };
  let service: CalendarService;

  const query = { start: '2026-09-01', end: '2026-09-30' };

  beforeEach(() => {
    prisma = {
      event: { findMany: jest.fn().mockResolvedValue([event()]) },
      venue: { findMany: jest.fn().mockResolvedValue([venue]) },
      composer: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new CalendarService(
      prisma as unknown as PrismaService,
      {
        get: jest.fn().mockResolvedValue(undefined),
        set: jest.fn(),
        invalidateMany: jest.fn(),
      } as unknown as AppCacheService,
    );
  });

  const where = () => prisma.event.findMany.mock.calls[0][0].where;

  // O legado mostrava rascunho, pendente e cancelado no site.
  it('o público vê só evento publicado', async () => {
    await service.calendar(query);

    expect(where().status).toBe('PUBLISHED');
  });

  it('administrador vê todos, e pode filtrar por estado', async () => {
    await service.calendar({ ...query, status: 'CANCELLED' }, { role: 1 });

    expect(where().status).toBe('CANCELLED');
  });

  // O legado só olhava o início: a temporada em cartaz sumia do mês.
  it('temporada que começou antes do período entra nele', async () => {
    await service.calendar(query);

    expect(where().OR).toEqual([
      {
        startDate: { gte: new Date('2026-09-01'), lte: new Date('2026-09-30') },
      },
      {
        startDate: { lt: new Date('2026-09-01') },
        endDate: { gte: new Date('2026-09-01') },
      },
    ]);
  });

  it('recusa período invertido ou longo demais', async () => {
    await expect(
      service.calendar({ start: '2026-09-30', end: '2026-09-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.calendar({ start: '2020-01-01', end: '2030-01-01' }),
    ).rejects.toThrow(/400 dias/);
  });

  // O legado refazia o horário no fuso do servidor.
  it('o início é o instante gravado, com o fuso do local', async () => {
    const { events } = await service.calendar(query);

    expect(events[0]).toMatchObject({
      start: new Date('2026-09-11T22:00:00Z'),
      timeZone: 'America/Belem',
      allDay: false,
    });
  });

  // Uma consulta por evento, no legado.
  it('compositores numa consulta só, até cinco por evento', async () => {
    prisma.event.findMany.mockResolvedValue([
      event({ id: 'e1', composerIds: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'] }),
      event({ id: 'e2', composerIds: ['c1'] }),
    ]);
    prisma.composer.findMany.mockResolvedValue(
      ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => ({
        id,
        name: id,
        portraitUrl: null,
      })),
    );

    const { events } = await service.calendar(query);

    expect(prisma.composer.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.composer.findMany.mock.calls[0][0].where.id.in).toHaveLength(
      5,
    );
    expect(events[0].composers).toHaveLength(5);
    expect(events[1].composers.map((c) => c.id)).toEqual(['c1']);
  });

  // Os cinco locais da base estão com scraping desligado: o legado dava filtros vazios.
  it('os filtros vêm dos locais ativos, e os tipos do enum inteiro', async () => {
    const { filters } = await service.calendar(query);

    expect(prisma.venue.findMany.mock.calls[0][0].where).toEqual({
      isActive: true,
    });
    expect(filters.cities).toEqual(['Belém']);
    expect(filters.types).toEqual(
      expect.arrayContaining(['BALLET', 'FESTIVAL', 'MASTERCLASS']),
    );
  });

  it('conta por tipo, local e cidade', async () => {
    const { metadata } = await service.calendar(query);

    expect(metadata).toEqual({
      totalEvents: 1,
      byType: { CONCERT: 1 },
      byVenue: { 'Theatro da Paz': 1 },
      byCity: { Belém: 1 },
    });
  });
});
