import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ScrapedEvent } from '../../common/interfaces/scraped-event.interface';
import { EventType, EventStatus, EventSource } from '@prisma/client';

export interface ImportResult {
  success: boolean;
  message: string;
  imported: number;
  failed: number;
  duplicates: number;
  details: ImportDetail[];
}

export interface ImportDetail {
  eventId?: string;
  externalId: string;
  title: string;
  status: 'success' | 'error' | 'duplicate';
  message: string;
}

@Injectable()
export class ImportService {
  constructor(private prisma: PrismaService) {}

  async importEvents(
    scraperId: string,
    events: ScrapedEvent[],
  ): Promise<ImportResult> {
    if (!events || events.length === 0) {
      return {
        success: false,
        message: 'Nenhum evento fornecido',
        imported: 0,
        failed: 0,
        duplicates: 0,
        details: [],
      };
    }

    console.log(`📦 Importando ${events.length} eventos de ${scraperId}...`);

    const results: ImportDetail[] = [];
    let imported = 0;
    let duplicates = 0;
    let errors = 0;

    for (const event of events) {
      try {
        // Verificar duplicata
        const existing = await this.prisma.event.findFirst({
          where: {
            OR: [
              { externalId: event.externalId },
              {
                AND: [
                  { title: event.title },
                  { startDate: new Date(event.startDate) },
                ],
              },
            ],
          },
        });

        if (existing) {
          duplicates++;
          results.push({
            externalId: event.externalId,
            title: event.title,
            status: 'duplicate',
            message: 'Evento já existe',
          });
          console.log(`⚠️  Duplicata: ${event.title}`);
          continue;
        }

        // Buscar ou criar venue
        const venue = await this.getOrCreateVenue(scraperId);

        // Buscar compositores
        const composerIds = await this.findComposers(event.composerNames || []);

        // Gerar slug único
        const slug = await this.generateUniqueSlug(event.slug);

        // Mapear source
        const source = this.mapScraperToSource(scraperId);

        // ✅ CAST do tipo para EventType
        const eventType = event.type as EventType;

        // Criar evento
        const createdEvent = await this.prisma.event.create({
          data: {
            title: event.title,
            slug,
            description: event.description,
            type: eventType, // ✅ CORRIGIDO
            status: EventStatus.PUBLISHED,
            source,
            startDate: new Date(event.startDate),
            startTime: event.startTime,
            endDate: event.endDate ? new Date(event.endDate) : null,
            endTime: event.endTime,
            venueId: venue.id,
            venueDetails: event.venueDetails,
            ticketUrl: event.ticketUrl,
            externalUrl: event.externalUrl,
            ticketInfo: event.ticketInfo,
            externalId: event.externalId,
            imageUrl: event.imageUrl,
            program: event.program,
            composerIds,
            isFree:
              event.ticketInfo?.toLowerCase().includes('gratuito') || false,
          },
        });

        imported++;
        results.push({
          eventId: createdEvent.id,
          externalId: event.externalId,
          title: event.title,
          status: 'success',
          message: 'Evento importado com sucesso',
        });

        console.log(`✅ ${event.title}`);
      } catch (error) {
        errors++;
        results.push({
          externalId: event.externalId,
          title: event.title,
          status: 'error',
          message: error.message || 'Erro ao importar evento',
        });
        console.error(`❌ ${event.title}:`, error.message);
      }
    }

    // Registrar log (se a tabela existir)
    try {
      await this.prisma.scrapingLog.create({
        data: {
          source: scraperId,
          status: imported > 0 ? 'success' : 'error',
          eventsFound: events.length,
          eventsCreated: imported,
          eventsSkipped: duplicates,
          newEvents: imported,
          details: { errors },
          finishedAt: new Date(),
        },
      });
    } catch (logError) {
      console.warn('⚠️ Não foi possível registrar log:', logError);
    }

    return {
      success: true,
      message: `${imported} evento(s) importado(s), ${duplicates} duplicata(s), ${errors} erro(s)`,
      imported,
      failed: errors,
      duplicates,
      details: results,
    };
  }

  // ==================== HELPER FUNCTIONS ====================

  /**
   * Buscar ou criar venue baseado no scraperId
   */
  private async getOrCreateVenue(scraperId: string) {
    const venueMap: Record<
      string,
      {
        name: string;
        slug: string;
        address: string;
        city: string;
        state: string;
        country: string;
        zipCode?: string;
        website?: string;
      }
    > = {
      osesp: {
        name: 'Sala São Paulo',
        slug: 'sala-sao-paulo',
        address: 'Praça Júlio Prestes, 16 - Campos Elíseos',
        city: 'São Paulo',
        state: 'SP',
        country: 'Brasil',
        zipCode: '01218-020',
        website: 'https://osesp.art.br',
      },
      'theatro-municipal': {
        name: 'Theatro Municipal de São Paulo',
        slug: 'theatro-municipal-sp',
        address: 'Praça Ramos de Azevedo, s/n - República',
        city: 'São Paulo',
        state: 'SP',
        country: 'Brasil',
        zipCode: '01037-010',
        website: 'https://theatromunicipal.org.br',
      },
    };

    const venueData = venueMap[scraperId];
    if (!venueData) {
      throw new Error(`Venue não configurado para scraper ${scraperId}`);
    }

    return this.prisma.venue.upsert({
      where: { slug: venueData.slug },
      update: {},
      create: venueData,
    });
  }

  /**
   * Buscar compositores por nome
   */
  private async findComposers(composerNames: string[]): Promise<string[]> {
    if (!composerNames || composerNames.length === 0) return [];

    const composerIds: string[] = [];

    for (const name of composerNames) {
      const composer = await this.prisma.composer.findFirst({
        where: {
          OR: [
            { fullName: { contains: name, mode: 'insensitive' } },
            { name: { contains: name, mode: 'insensitive' } },
          ],
        },
      });

      if (composer) {
        composerIds.push(composer.id);
      }
    }

    return composerIds;
  }

  /**
   * Gerar slug único (evitar duplicatas)
   */
  private async generateUniqueSlug(baseSlug: string): Promise<string> {
    let slug = baseSlug;
    let counter = 1;

    while (await this.prisma.event.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    return slug;
  }

  /**
   * Mapear scraperId para EventSource do Prisma
   */
  private mapScraperToSource(scraperId: string): EventSource {
    const sourceMap: Record<string, EventSource> = {
      osesp: EventSource.SCRAPER,
      'theatro-municipal': EventSource.SCRAPER,
    };

    return sourceMap[scraperId] || EventSource.ADMIN;
  }
}
