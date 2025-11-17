export interface ScrapedEvent {
  title: string;
  slug: string;
  description: string;
  type: any;
  startDate: Date;
  startTime: string | null;
  endDate?: Date | null;
  endTime?: string | null;
  venueDetails: string | null;
  ticketUrl: string | null;
  externalUrl: string;
  ticketInfo: string | null;
  externalId: string;
  imageUrl: string | null;
  composerNames: string[];
  performers: string[];
  program: string | null;
  duration?: number;

  // ✅ Propriedades opcionais para detecção de duplicatas
  isDuplicate?: boolean;
  existingEventId?: string;
  existingEventSlug?: string;
}
