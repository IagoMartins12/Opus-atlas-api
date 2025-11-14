export interface ScrapedEvent {
  title: string;
  slug: string;
  description: string;
  type: string;
  startDate: Date;
  startTime: string | null;
  endDate: Date | null;
  endTime: string | null;
  venueDetails: string | null;
  ticketUrl: string | null;
  externalUrl: string | null;
  ticketInfo: string | null;
  externalId: string;
  imageUrl: string | null;
  composerNames: string[];
  performers: string[];
  program: string | null;
  isDuplicate?: boolean;
}

export interface ScraperResponse {
  success: boolean;
  eventsFound: number;
  eventsScraped: number;
  newEvents: number;
  duplicates: number;
  events: ScrapedEvent[];
  errors: string[];
  executionTime: number;
}
