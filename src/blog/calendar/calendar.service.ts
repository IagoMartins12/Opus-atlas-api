import { BadRequestException, Injectable } from '@nestjs/common';
import { EventStatus, EventType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace, CacheTtl } from '../../common/cache/cache-keys';
import { cachedRead, cacheKey } from '../shared/cached-read';
import { BlogCalendarQueryDto } from './dto/calendar.dto';
import { colorsFor, eventWindow, timeZoneOf } from './event-time';

/** Maior período que uma consulta ao calendário abrange. */
export const MAX_RANGE_DAYS = 400;

/** Compositores mostrados por evento, como no legado. */
const COMPOSERS_PER_EVENT = 5;

const ROLE_ADMIN = 1;

/**
 * O calendário público de concertos.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AppCacheService,
  ) {}

  /**
   * Eventos de um período, com filtros e agregados.
   *
   * Três correções sobre o legado:
   *
   * - **só evento publicado** para o público. O legado não filtrava estado:
   *   rascunho, pendente e cancelado apareciam no calendário do site;
   * - **temporada que começou antes do período aparece nele.** O legado só
   *   olhava a data de início: "Wicked, 15/07 a 04/10" sumia do calendário de
   *   agosto, em cartaz;
   * - **compositores numa consulta só**, e não uma por evento.
   *
   * E o horário é o gravado — ver `eventWindow`.
   */
  async calendar(query: BlogCalendarQueryDto, viewer?: { role: number }) {
    // O calendário de administrador (todos os estados) não entra no cache.
    if (viewer && viewer.role >= ROLE_ADMIN) {
      return this.load(query, true);
    }

    return cachedRead(
      this.cache,
      cacheKey(CacheNamespace.BLOG_CALENDAR, 'period', { ...query }),
      CacheTtl.MUTABLE,
      'blog/calendar',
      () => this.load(query, false),
    );
  }

  private async load(query: BlogCalendarQueryDto, isAdmin: boolean) {
    const start = new Date(query.start);
    const end = new Date(query.end);

    if (end.getTime() < start.getTime()) {
      throw new BadRequestException('`end` é anterior a `start`');
    }

    const days = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);

    // Sem teto, um período de cem anos numa rota pública carrega a coleção
    // inteira, com o local e os compositores de cada evento.
    if (days > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `O período consultado passa de ${MAX_RANGE_DAYS} dias`,
      );
    }

    const where: Prisma.EventWhereInput = {
      OR: [
        { startDate: { gte: start, lte: end } },
        { startDate: { lt: start }, endDate: { gte: start } },
      ],
      ...(isAdmin
        ? query.status
          ? { status: query.status }
          : {}
        : { status: EventStatus.PUBLISHED }),
      ...(query.venueId ? { venueId: query.venueId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.city || query.state
        ? {
            venue: {
              ...(query.city ? { city: query.city } : {}),
              ...(query.state ? { state: query.state } : {}),
            },
          }
        : {}),
    };

    const [events, venues] = await Promise.all([
      this.prisma.event.findMany({
        where,
        include: {
          venue: { select: { id: true, name: true, city: true, state: true } },
        },
        orderBy: { startDate: 'asc' },
        take: 2000,
      }),
      // O legado listava só os locais com scraping ligado — e os cinco da base
      // estão com `scrapingEnabled: false`: os filtros de cidade, estado e
      // local saíam vazios. Aqui entram os locais ativos.
      this.prisma.venue.findMany({
        where: { isActive: true },
        select: { id: true, name: true, city: true, state: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const composerIds = [
      ...new Set(
        events.flatMap((event) =>
          event.composerIds.slice(0, COMPOSERS_PER_EVENT),
        ),
      ),
    ];

    const composers = composerIds.length
      ? await this.prisma.composer.findMany({
          where: { id: { in: composerIds } },
          select: { id: true, name: true, portraitUrl: true },
        })
      : [];

    const composerById = new Map(
      composers.map((composer) => [composer.id, composer]),
    );

    const items = events.map((event) => {
      const timeZone = timeZoneOf(event.venue.state);
      const window = eventWindow(event, timeZone);

      return {
        id: event.id,
        slug: event.slug,
        title: event.title,
        start: window.start,
        end: window.end,
        allDay: window.allDay,
        timeZone,
        type: event.type,
        status: event.status,
        venue: event.venue,
        composers: event.composerIds
          .slice(0, COMPOSERS_PER_EVENT)
          .map((id) => composerById.get(id))
          .filter((composer) => composer !== undefined)
          .map((composer) => ({
            id: composer.id,
            name: composer.name,
            portraitUrl: composer.portraitUrl ?? undefined,
          })),
        imageUrl: event.imageUrl ?? undefined,
        description: event.description ?? undefined,
        program:
          event.program !== null && typeof event.program === 'object'
            ? JSON.stringify(event.program)
            : (event.program ?? undefined),
        ticketUrl: event.ticketUrl ?? undefined,
        isFree: event.isFree,
        ...colorsFor(event.type, event.isFree),
      };
    });

    const countBy = (key: (item: (typeof items)[number]) => string) =>
      items.reduce<Record<string, number>>((acc, item) => {
        acc[key(item)] = (acc[key(item)] ?? 0) + 1;
        return acc;
      }, {});

    return {
      success: true,
      events: items,
      period: { start, end, view: query.view ?? 'month' },
      metadata: {
        totalEvents: items.length,
        byType: countBy((item) => item.type),
        byVenue: countBy((item) => item.venue.name),
        byCity: countBy((item) => item.venue.city),
      },
      filters: {
        cities: [...new Set(venues.map((venue) => venue.city))].sort(),
        states: [...new Set(venues.map((venue) => venue.state))].sort(),
        venues: venues.map((venue) => ({
          id: venue.id,
          name: venue.name,
          city: venue.city,
        })),
        // O legado listava seis tipos à mão; o enum tem dezesseis, e balé,
        // masterclass ou festival nunca apareciam como filtro.
        types: Object.values(EventType),
      },
    };
  }
}
