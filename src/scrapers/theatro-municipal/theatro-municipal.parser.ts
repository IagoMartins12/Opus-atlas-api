import { CheerioDocument } from '../imslp/imslp-work.parser';

/** Meses por extenso, como o sítio os escreve. */
const MONTHS: Record<string, number> = {
  janeiro: 0,
  fevereiro: 1,
  março: 2,
  marco: 2,
  abril: 3,
  maio: 4,
  junho: 5,
  julho: 6,
  agosto: 7,
  setembro: 8,
  outubro: 9,
  novembro: 10,
  dezembro: 11,
};

const DATE_WITH_TIME = new RegExp(
  `(\\d{1,2})\\s+de\\s+(${Object.keys(MONTHS).join('|')})\\s+de\\s+(\\d{4})(?:\\s+(\\d{1,2}):(\\d{2}))?`,
  'gi',
);

/** Onde a página anuncia as sessões. */
const DATES_HEADING = 'Datas Disponíveis';

/** Quanto do texto depois do cabeçalho pode conter sessões. */
const DATES_WINDOW = 2_000;

export interface EventSession {
  startDate: Date;
  startTime: string | null;
}

/**
 * As sessões de um evento do Theatro Municipal.
 *
 * **A âncora é o texto do cabeçalho, não a classe do elemento.** A página é
 * montada em Elementor, e as classes são identificadores gerados
 * (`elementor-element-aaee418`) que mudam a cada edição do layout — prender o
 * scraper a elas é garantir que ele quebre na próxima mexida no site. O rótulo
 * "Datas Disponíveis" é conteúdo, e conteúdo muda muito mais devagar.
 */
export function extractSessions($: CheerioDocument): EventSession[] {
  $('script, style').remove();

  const text = $('body').text().replace(/\s+/g, ' ');
  const start = text.indexOf(DATES_HEADING);

  if (start < 0) {
    return [];
  }

  const window = text.slice(start, start + DATES_WINDOW);
  const sessions: EventSession[] = [];

  for (const match of window.matchAll(DATE_WITH_TIME)) {
    const [, day, month, year, hour, minute] = match;
    const monthIndex = MONTHS[month.toLowerCase()];

    if (monthIndex === undefined) {
      continue;
    }

    const date = new Date(
      Number(year),
      monthIndex,
      Number(day),
      Number(hour ?? 0),
      Number(minute ?? 0),
    );

    if (Number.isNaN(date.getTime())) {
      continue;
    }

    sessions.push({
      startDate: date,
      startTime: hour ? `${hour.padStart(2, '0')}:${minute}` : null,
    });
  }

  return sessions;
}

/** O texto de apresentação do evento, para descrição. */
export function extractSummary($: CheerioDocument): string {
  const paragraphs: string[] = [];

  $('.elementor-widget-theme-post-content p, article p').each(
    (_: number, element: unknown) => {
      const text = $(element as never)
        .text()
        .replace(/\s+/g, ' ')
        .trim();

      if (text.length > 40) {
        paragraphs.push(text);
      }
    },
  );

  return paragraphs.slice(0, 3).join('\n').slice(0, 1_500);
}
