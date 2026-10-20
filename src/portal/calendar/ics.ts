/**
 * Gerador de iCalendar (RFC 5545) para as aulas do portal (04/10/2026).
 *
 * Serve à assinatura (`webcal://`, que o Google, a Apple e o Outlook
 * atualizam sozinhos) e ao download de um período. Três cuidados que fazem a
 * assinatura funcionar de verdade:
 *
 * - **UID estável por aula**: o calendário reconhece a mesma aula de uma
 *   leitura para outra, e remarcação vira mudança em vez de evento duplicado;
 * - **SEQUENCE crescente** (os segundos de `updatedAt`): sem isso o cliente
 *   ignora a mudança;
 * - **aula cancelada sai com `STATUS:CANCELLED`**, em vez de sumir — sumir do
 *   feed nem sempre apaga o evento do lado de lá.
 */

export interface IcsLesson {
  id: string;
  title: string;
  scheduledAt: Date;
  duration: number;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | 'RESCHEDULED';
  location: string | null;
  description: string | null;
  updatedAt: Date;
  /** "com Helena Duarte" / "com Marina Costa". */
  counterpart: string | null;
  url: string | null;
}

const PRODID = '-//Opus Atlas//Portal//PT-BR';

/** Data/hora em UTC no formato iCalendar: 20261008T180000Z. */
export const icsDate = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** Escapa texto: barra invertida, ponto e vírgula, vírgula e quebra de linha. */
export const icsText = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

/**
 * Dobra linhas maiores que 75 octetos (não caracteres): acento ocupa dois
 * bytes em UTF-8, e cortar no meio de um caractere corrompe o texto.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74; // a continuação começa com espaço
    if (size + bytes > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function buildCalendar(options: {
  name: string;
  lessons: IcsLesson[];
  now?: Date;
}): string {
  const stamp = icsDate(options.now ?? new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(options.name)}`,
    'X-WR-TIMEZONE:America/Sao_Paulo',
    // Os clientes que respeitam isto releem a assinatura a cada hora.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];

  for (const lesson of options.lessons) {
    const end = new Date(
      lesson.scheduledAt.getTime() + lesson.duration * 60_000,
    );
    const summary = lesson.counterpart
      ? `${lesson.title} — ${lesson.counterpart}`
      : lesson.title;
    lines.push(
      'BEGIN:VEVENT',
      `UID:lesson-${lesson.id}@opusatlas.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(lesson.scheduledAt)}`,
      `DTEND:${icsDate(end)}`,
      `SEQUENCE:${Math.floor(lesson.updatedAt.getTime() / 1000)}`,
      `SUMMARY:${icsText(summary)}`,
      `STATUS:${lesson.status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED'}`,
    );
    if (lesson.location) lines.push(`LOCATION:${icsText(lesson.location)}`);
    if (lesson.description)
      lines.push(`DESCRIPTION:${icsText(lesson.description)}`);
    if (lesson.url) lines.push(`URL:${lesson.url}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
