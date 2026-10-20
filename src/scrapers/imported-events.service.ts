import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { escapeRegex } from '../common/utils/regex.util';
import { PrismaService } from '../prisma/prisma.service';
import { ListImportedEventsQueryDto } from './dto/scrapers.dto';
import { ScraperRegistry } from './scraper-registry';

/**
 * Os eventos que os scrapers trouxeram, já no banco.
 *
 * O resultado de uma rodada diz o que aconteceu naquela rodada; esta lista
 * é o acervo: tudo que entrou por scraper, de todas as rodadas, com a casa,
 * o estado de moderação e o link de origem. A casa se filtra pelo `slug` da
 * sala que o scraper declara — o evento não guarda o id do scraper.
 */
@Injectable()
export class ImportedEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ScraperRegistry,
  ) {}

  async list(query: ListImportedEventsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.EventWhereInput = { source: 'SCRAPER' };

    if (query.scraperId) {
      const slug = this.registry.require(query.scraperId).getConfig().venueSlug;
      where.venue = { slug };
    }
    if (query.status) where.status = query.status;
    if (query.search?.trim()) {
      where.title = {
        contains: escapeRegex(query.search.trim()),
        mode: 'insensitive',
      };
    }
    if (query.when === 'futuros') where.startDate = { gte: new Date() };
    if (query.when === 'passados') where.startDate = { lt: new Date() };
    if (query.importedFrom) {
      where.createdAt = { gte: new Date(query.importedFrom) };
    }

    const [items, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          startDate: true,
          startTime: true,
          room: true,
          externalUrl: true,
          ticketUrl: true,
          createdAt: true,
          venue: { select: { id: true, name: true, slug: true, city: true } },
        },
      }),
      this.prisma.event.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  /** Um evento, com o que a ficha do painel mostra. */
  async get(id: string) {
    // Id que não é ObjectId faria o Prisma estourar em 500.
    if (!/^[a-f\d]{24}$/i.test(id)) {
      throw new NotFoundException('Evento não encontrado');
    }
    const event = await this.prisma.event.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        subtitle: true,
        slug: true,
        status: true,
        source: true,
        type: true,
        startDate: true,
        startTime: true,
        endDate: true,
        room: true,
        description: true,
        conductor: true,
        ensemble: true,
        soloists: true,
        ticketInfo: true,
        isFree: true,
        imageUrl: true,
        externalId: true,
        externalUrl: true,
        ticketUrl: true,
        createdAt: true,
        updatedAt: true,
        venue: { select: { id: true, name: true, slug: true, city: true } },
      },
    });
    if (!event) throw new NotFoundException('Evento não encontrado');
    return event;
  }
}
