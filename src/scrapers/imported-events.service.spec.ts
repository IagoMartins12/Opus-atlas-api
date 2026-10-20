import { ImportedEventsService } from './imported-events.service';

describe('ImportedEventsService', () => {
  const prisma = {
    event: {
      findMany: jest.fn().mockResolvedValue([{ id: 'e1' }]),
      count: jest.fn().mockResolvedValue(41),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  const registry = {
    require: jest
      .fn()
      .mockReturnValue({ getConfig: () => ({ venueSlug: 'sala-sp' }) }),
  };
  const service = new ImportedEventsService(prisma as never, registry as never);

  beforeEach(() => jest.clearAllMocks());

  it('só eventos de scraper, paginados, com o total', async () => {
    const r = await service.list({ page: 2, limit: 20 });

    const args = prisma.event.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ source: 'SCRAPER' });
    expect(args.skip).toBe(20);
    expect(r.pagination).toEqual({
      page: 2,
      limit: 20,
      total: 41,
      totalPages: 3,
    });
  });

  it('a casa vira o slug da sala; os outros filtros vão ao where', async () => {
    await service.list({
      scraperId: 'osesp',
      status: 'PENDING',
      search: ' Mahler ',
      when: 'futuros',
      importedFrom: '2026-09-01',
    } as never);

    const where = prisma.event.findMany.mock.calls[0][0].where;
    expect(where.venue).toEqual({ slug: 'sala-sp' });
    expect(where.status).toBe('PENDING');
    expect(where.title).toEqual({ contains: 'Mahler', mode: 'insensitive' });
    expect(where.startDate.gte).toBeInstanceOf(Date);
    expect(where.createdAt.gte).toEqual(new Date('2026-09-01'));
  });

  it('um evento: id inválido ou inexistente é 404', async () => {
    await expect(service.get('abc')).rejects.toThrow('Evento não encontrado');
    await expect(service.get('a'.repeat(24))).rejects.toThrow(
      'Evento não encontrado',
    );
    prisma.event.findUnique.mockResolvedValueOnce({ id: 'a'.repeat(24) });
    await expect(service.get('a'.repeat(24))).resolves.toEqual({
      id: 'a'.repeat(24),
    });
  });
});
