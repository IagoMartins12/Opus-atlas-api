import { EventType } from '@prisma/client';

/**
 * Forma canônica de um evento extraído por qualquer scraper de casa de
 * espetáculo, antes de ser persistido pelo `ImportService`.
 *
 * A nulidade de cada campo reflete o que os scrapers realmente conseguem
 * extrair: uma página de programação pode não ter link de ingresso, horário
 * de término ou imagem. Campos marcados como não-nulos são os que todo
 * scraper é obrigado a preencher.
 */
export interface ScrapedEvent {
  title: string;
  slug: string;
  description: string;
  /** Categoria do evento, mapeada para o enum do Prisma pelo scraper. */
  type: EventType;
  startDate: Date;
  startTime: string | null;
  endDate?: Date | null;
  endTime?: string | null;
  venueDetails: string | null;
  ticketUrl: string | null;
  /** Nem toda listagem expõe uma página própria por evento. */
  externalUrl: string | null;
  ticketInfo: string | null;
  externalId: string;
  imageUrl: string | null;
  composerNames: string[];
  performers: string[];
  program: string | null;
  duration?: number;

  // Preenchidos na etapa de detecção de duplicatas, não pelo scraper.
  isDuplicate?: boolean;
  existingEventId?: string;
  existingEventSlug?: string;
}
