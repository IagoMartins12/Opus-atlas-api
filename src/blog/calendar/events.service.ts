import { escapeRegex } from '../../common/utils/regex.util';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventSource, EventStatus, Prisma } from '@prisma/client';
import { isMongoId } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace } from '../../common/cache/cache-keys';
import { blogSlug } from '../articles/article-text';
import { urlField } from '../shared/url-field';
import {
  CreateEventDto,
  CreateVenueDto,
  MAX_FEATURED_EVENTS,
  UpdateEventDto,
  UpdateVenueDto,
} from './dto/calendar.dto';
import { parseTime } from './event-time';
import { ROLE } from '../../common/auth/roles';

const ROLE_ADMIN = ROLE.ADMIN;

type Data = Record<string, unknown>;

/**
 * Eventos e locais do calendário, do lado do painel.
 *
 * **O super administrador era barrado.** Toda escrita do legado conferia
 * `session.user.role !== 1` — e o super administrador tem papel 2. O papel
 * mais alto da plataforma recebia 403 justamente aqui. As rotas agora exigem
 * `ADMIN` ou acima.
 *
 * **As edições repassavam o corpo inteiro ao Prisma**, tirando só `id`,
 * `createdAt` e `slug`: `viewCount`, `source`, `verifiedBy` e escrita aninhada
 * no local passavam. Aqui os campos são montados um a um.
 */
@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AppCacheService,
  ) {}

  private async invalidate(): Promise<void> {
    await this.cache.invalidateMany([CacheNamespace.BLOG_CALENDAR]);
  }

  // -------------------------------------------------------------------
  // Eventos
  // -------------------------------------------------------------------

  /** Um evento. Fora do ar, só para administrador. */
  async getEvent(id: string, viewer?: { role: number }) {
    const event = await this.prisma.event.findUnique({
      where: { id: this.validId(id, 'Evento') },
      include: { venue: true },
    });

    if (
      !event ||
      (event.status !== EventStatus.PUBLISHED &&
        !(viewer && viewer.role >= ROLE_ADMIN))
    ) {
      throw new NotFoundException('Evento não encontrado');
    }

    return { success: true, event };
  }

  async createEvent(dto: CreateEventDto, userId: string) {
    await this.requireVenue(dto.venueId);

    const status = dto.status ?? EventStatus.PENDING;
    const now = new Date();

    const startDate = new Date(dto.startDate);
    const featured = await this.featuredPlan(dto, null, startDate);

    const event = await this.prisma.event.create({
      data: {
        ...this.eventData(dto),
        ...featured.data,
        title: dto.title.trim(),
        slug: await this.uniqueSlug('event', dto.title),
        type: dto.type,
        status,
        source: EventSource.ADMIN,
        venueId: dto.venueId,
        startDate,
        submittedBy: userId,
        submittedAt: now,
        publishedAt: status === EventStatus.PUBLISHED ? now : null,
        // O legado gravava `verifiedBy` sempre, mesmo com `isVerified: false`:
        // o evento dizia quem o verificou sem ter sido verificado.
        ...(dto.isVerified ? { verifiedBy: userId, verifiedAt: now } : {}),
      } as Prisma.EventUncheckedCreateInput,
      include: { venue: true },
    });

    await featured.release(event.id);
    await this.invalidate();

    return { success: true, event, message: 'Evento criado com sucesso' };
  }

  async updateEvent(id: string, dto: UpdateEventDto, userId: string) {
    const existing = await this.prisma.event.findUnique({
      where: { id: this.validId(id, 'Evento') },
      select: {
        publishedAt: true,
        isVerified: true,
        startDate: true,
        isFeatured: true,
        featuredOrder: true,
        featuredSize: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Evento não encontrado');
    }

    if (dto.venueId) {
      await this.requireVenue(dto.venueId);
    }

    const data: Data = this.eventData(dto, existing.startDate);
    const now = new Date();

    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.venueId !== undefined) data.venueId = dto.venueId;
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);

    if (dto.status !== undefined) {
      data.status = dto.status;

      if (dto.status === EventStatus.PUBLISHED && !existing.publishedAt) {
        data.publishedAt = now;
      }
    }

    if (dto.isVerified === true && !existing.isVerified) {
      data.verifiedBy = userId;
      data.verifiedAt = now;
    }

    const featured = await this.featuredPlan(
      dto,
      { id, ...existing },
      dto.startDate !== undefined
        ? new Date(dto.startDate)
        : existing.startDate,
    );
    Object.assign(data, featured.data);

    const event = await this.prisma.event.update({
      where: { id },
      data: data as Prisma.EventUncheckedUpdateInput,
      include: { venue: true },
    });

    await featured.release(event.id);
    await this.invalidate();

    return { success: true, event, message: 'Evento atualizado com sucesso' };
  }

  async deleteEvent(id: string) {
    const existing = await this.prisma.event.findUnique({
      where: { id: this.validId(id, 'Evento') },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Evento não encontrado');
    }

    await this.prisma.event.delete({ where: { id } });
    await this.invalidate();

    return { success: true, message: 'Evento apagado com sucesso' };
  }

  // -------------------------------------------------------------------
  // Locais
  // -------------------------------------------------------------------

  async getVenue(id: string) {
    const venue = await this.prisma.venue.findUnique({
      where: { id: this.validId(id, 'Local') },
      include: { _count: { select: { events: true } } },
    });

    if (!venue) {
      throw new NotFoundException('Local não encontrado');
    }

    return { success: true, venue };
  }

  async createVenue(dto: CreateVenueDto) {
    const venue = await this.prisma.venue.create({
      data: {
        ...this.venueData(dto),
        name: dto.name.trim(),
        slug: await this.uniqueSlug('venue', dto.name),
        city: dto.city.trim(),
        state: dto.state,
        country: dto.country?.trim() || 'Brasil',
      } as Prisma.VenueCreateInput,
    });

    await this.invalidate();

    return { success: true, venue, message: 'Local criado com sucesso' };
  }

  /**
   * Edita o local. **O slug não muda**: é por ele que a importação dos
   * scrapers acha a casa (`upsert` por slug) — trocá-lo faria a próxima
   * rodada criar uma segunda casa com o mesmo teatro.
   */
  async updateVenue(id: string, dto: UpdateVenueDto) {
    await this.requireVenue(id);

    const data: Data = this.venueData(dto);

    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.city !== undefined) data.city = dto.city.trim();
    if (dto.state !== undefined) data.state = dto.state;
    if (dto.country !== undefined)
      data.country = dto.country.trim() || 'Brasil';

    const venue = await this.prisma.venue.update({
      where: { id },
      data: data as Prisma.VenueUpdateInput,
    });

    await this.invalidate();

    return { success: true, venue, message: 'Local atualizado com sucesso' };
  }

  async deleteVenue(id: string) {
    await this.requireVenue(id);

    const events = await this.prisma.event.count({ where: { venueId: id } });

    if (events > 0) {
      throw new BadRequestException(
        `Este local tem ${events} evento(s). Mova ou apague os eventos antes.`,
      );
    }

    await this.prisma.venue.delete({ where: { id } });
    await this.invalidate();

    return { success: true, message: 'Local apagado com sucesso' };
  }

  // -------------------------------------------------------------------

  /**
   * O destaque do evento no mosaico da agenda: até três por mês (o mês em
   * que o evento começa, no fuso de Brasília), cada um numa posição.
   *
   * Sem posição, o evento entra na menor livre; com o mês cheio e sem
   * posição, a gravação é recusada. **Posição ocupada é substituída**: o
   * evento que estava nela deixa de ser destaque (`release`, depois de
   * gravar). Mudar o evento de mês leva o destaque junto e confere de novo.
   */
  private async featuredPlan(
    dto: UpdateEventDto,
    existing: {
      id: string;
      isFeatured: boolean;
      featuredOrder: number | null;
      featuredSize: string | null;
    } | null,
    startDate: Date,
  ): Promise<{ data: Data; release: (id: string) => Promise<void> }> {
    const nothing = { data: {}, release: async () => undefined };
    const featuring = dto.isFeatured ?? existing?.isFeatured ?? false;

    if (!featuring) {
      return dto.isFeatured === false
        ? {
            data: {
              isFeatured: false,
              featuredOrder: null,
              featuredSize: null,
            },
            release: nothing.release,
          }
        : nothing;
    }

    const touched =
      dto.isFeatured !== undefined ||
      dto.featuredOrder !== undefined ||
      dto.featuredSize !== undefined ||
      dto.startDate !== undefined;
    if (!touched) return nothing;

    const { start, end } = monthOf(startDate);
    const others = await this.prisma.event.findMany({
      where: {
        isFeatured: true,
        startDate: { gte: start, lt: end },
        ...(existing ? { id: { not: existing.id } } : {}),
      },
      select: { id: true, featuredOrder: true },
    });
    const taken = new Set(others.map((o) => o.featuredOrder));

    let order = dto.featuredOrder ?? existing?.featuredOrder ?? null;
    if (!order || (dto.featuredOrder == null && taken.has(order))) {
      order =
        Array.from({ length: MAX_FEATURED_EVENTS }, (_, i) => i + 1).find(
          (n) => !taken.has(n),
        ) ?? null;
      if (!order) {
        throw new BadRequestException(
          `Este mês já tem ${MAX_FEATURED_EVENTS} eventos em destaque. ` +
            'Escolha uma posição para substituir um deles.',
        );
      }
    }

    const displaced = others.filter((o) => o.featuredOrder === order);
    const size = dto.featuredSize ?? existing?.featuredSize ?? 'normal';

    return {
      data: { isFeatured: true, featuredOrder: order, featuredSize: size },
      release: async (id: string) => {
        const ids = displaced.map((o) => o.id).filter((other) => other !== id);
        if (!ids.length) return;
        await this.prisma.event.updateMany({
          where: { id: { in: ids } },
          data: { isFeatured: false, featuredOrder: null, featuredSize: null },
        });
      },
    };
  }

  private eventData(dto: UpdateEventDto, currentStart?: Date): Data {
    const data: Data = {};
    const set = (key: string, value: unknown) => {
      if (value !== undefined) data[key] = value;
    };

    for (const key of [
      'subtitle',
      'description',
      'fullDetails',
      'room',
      'doors',
      'conductor',
      'ensemble',
      'ticketInfo',
      'ageRating',
      'venueDetails',
      'metaTitle',
      'metaDescription',
    ] as const) {
      set(key, trimmed(dto[key]));
    }

    for (const key of [
      'composerIds',
      'workIds',
      'instrumentIds',
      'epochIds',
      'soloists',
      'keywords',
    ] as const) {
      set(key, dto[key] ? [...new Set(dto[key])] : undefined);
    }

    set('isFree', dto.isFree);
    set('isVerified', dto.isVerified);
    set('showOnMainHome', dto.showOnMainHome);
    set('duration', dto.duration);

    set(
      'startTime',
      dto.startTime === undefined ? undefined : parseTime(dto.startTime),
    );
    set(
      'endTime',
      dto.endTime === undefined ? undefined : parseTime(dto.endTime),
    );

    // Campos `Json` do schema; o painel manda texto, e é texto que se grava.
    set('program', trimmed(dto.program));
    set('ticketPrice', trimmed(dto.ticketPrice));
    set('performers', dto.performers);

    set('ticketUrl', urlField(dto.ticketUrl, 'link', 'ticketUrl'));
    set('externalUrl', urlField(dto.externalUrl, 'link', 'externalUrl'));
    set('imageUrl', urlField(dto.imageUrl, 'media', 'imageUrl'));
    set('coverImageUrl', urlField(dto.coverImageUrl, 'media', 'coverImageUrl'));
    set('videoUrl', urlField(dto.videoUrl, 'media-or-youtube', 'videoUrl'));
    set(
      'galleryImages',
      dto.galleryImages
        ?.map((url, index) => urlField(url, 'media', `galleryImages[${index}]`))
        .filter(Boolean),
    );

    if (dto.endDate !== undefined) {
      const endDate = dto.endDate ? new Date(dto.endDate) : null;
      const startDate = dto.startDate ? new Date(dto.startDate) : currentStart;

      if (endDate && startDate && endDate.getTime() < startDate.getTime()) {
        throw new BadRequestException('`endDate` é anterior a `startDate`');
      }

      data.endDate = endDate;
    }

    return data;
  }

  private venueData(dto: UpdateVenueDto): Data {
    const data: Data = {};
    const set = (key: string, value: unknown) => {
      if (value !== undefined) data[key] = value;
    };

    for (const key of [
      'shortName',
      'address',
      'zipCode',
      'email',
      'phone',
      'description',
      'history',
      'metaTitle',
      'metaDescription',
    ] as const) {
      set(key, trimmed(dto[key]));
    }

    set('capacity', dto.capacity);
    set('scrapingEnabled', dto.scrapingEnabled);
    set('isVerified', dto.isVerified);
    set('isActive', dto.isActive);
    set('website', urlField(dto.website, 'link', 'website'));
    set('scrapingUrl', urlField(dto.scrapingUrl, 'link', 'scrapingUrl'));
    set('logoUrl', urlField(dto.logoUrl, 'media', 'logoUrl'));
    set('coverImageUrl', urlField(dto.coverImageUrl, 'media', 'coverImageUrl'));
    set(
      'galleryImages',
      dto.galleryImages
        ?.map((url, index) => urlField(url, 'media', `galleryImages[${index}]`))
        .filter(Boolean),
    );

    return data;
  }

  /** Slug livre a partir do nome, no mesmo algoritmo do legado. */
  private async uniqueSlug(model: 'event' | 'venue', name: string) {
    const base = blogSlug(name) || model;
    const rows =
      model === 'event'
        ? await this.prisma.event.findMany({
            where: { slug: { startsWith: escapeRegex(base) } },
            select: { slug: true },
          })
        : await this.prisma.venue.findMany({
            where: { slug: { startsWith: escapeRegex(base) } },
            select: { slug: true },
          });
    const taken = new Set(rows.map((row) => row.slug));

    if (!taken.has(base)) return base;

    let counter = 1;
    while (taken.has(`${base}-${counter}`)) counter += 1;
    return `${base}-${counter}`;
  }

  private async requireVenue(id: string) {
    const venue = await this.prisma.venue.findUnique({
      where: { id: this.validId(id, 'Local') },
      select: { id: true },
    });

    if (!venue) {
      throw new NotFoundException('Local não encontrado');
    }
  }

  private validId(id: string, label: 'Evento' | 'Local'): string {
    if (!isMongoId(id)) {
      throw new NotFoundException(`${label} não encontrado`);
    }

    return id;
  }
}

function trimmed(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value?.trim() || null;
}

/**
 * O mês (de Brasília) em que um instante cai, como intervalo em UTC. O
 * Brasil não tem horário de verão desde 2019: o deslocamento é fixo.
 */
function monthOf(date: Date): { start: Date; end: Date } {
  const local = new Date(date.getTime() - 3 * 3_600_000);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1, 3)),
    end: new Date(Date.UTC(year, month + 1, 1, 3)),
  };
}
