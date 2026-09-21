import { EventType } from '@prisma/client';
import { localDate, zonedDate } from '../../common/utils/time-zone';

export { localDate, zonedDate };

/**
 * Fuso de cada UF.
 *
 * O Brasil não tem horário de verão desde 2019, mas tem quatro fusos. O
 * Theatro da Paz fica em Belém (−3) e o Teatro Amazonas em Manaus (−4): usar um
 * fuso só para o país inteiro erra o horário de uma das casas.
 */
const TIME_ZONE_BY_UF: Record<string, string> = {
  AC: 'America/Rio_Branco',
  AM: 'America/Manaus',
  RR: 'America/Boa_Vista',
  RO: 'America/Porto_Velho',
  MT: 'America/Cuiaba',
  MS: 'America/Campo_Grande',
  PA: 'America/Belem',
  AP: 'America/Belem',
  TO: 'America/Araguaina',
  MA: 'America/Fortaleza',
  PI: 'America/Fortaleza',
  CE: 'America/Fortaleza',
  RN: 'America/Fortaleza',
  PB: 'America/Fortaleza',
  PE: 'America/Recife',
  AL: 'America/Maceio',
  SE: 'America/Maceio',
  BA: 'America/Bahia',
};

export const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';

/** Duração presumida quando o evento não diz quando termina. */
export const DEFAULT_DURATION_MINUTES = 120;

export function timeZoneOf(uf: string | null | undefined): string {
  return TIME_ZONE_BY_UF[(uf ?? '').trim().toUpperCase()] ?? DEFAULT_TIME_ZONE;
}

/** `"19:30"`, `"19h30"` ou `"19h"` → `"19:30"`; o resto, `null`. */
export function parseTime(value: string | null | undefined): string | null {
  const match = (value ?? '').trim().match(/^(\d{1,2})(?:[:h](\d{2})?)?h?$/i);

  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? '0');

  if (hours > 23 || minutes > 59) return null;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export interface EventTiming {
  startDate: Date;
  startTime: string | null;
  endDate: Date | null;
  endTime: string | null;
  duration: number | null;
}

/**
 * Início e fim de um evento no calendário.
 *
 * **O legado refazia o horário no fuso do servidor.** `startDate` já guarda o
 * instante exato (19h em Brasília é `22:00Z`), e o calendário fazia
 * `setHours(19, 0)` sobre ele — no fuso de quem roda o Node. Em contêiner, que
 * roda em UTC, isso vira 19h UTC: **16h em Brasília, três horas antes**. Aqui o
 * início é o `startDate` como está.
 *
 * O fim usa o `endTime` na data local do início (e passa para o dia seguinte
 * se for antes do início), ou a duração, ou duas horas — o legado ignorava o
 * `endTime` e somava duas horas sempre.
 *
 * **Evento sem horário é temporada**, não sessão ("Wicked, 15/07 a 04/10"): vai
 * como dia inteiro, do início ao fim do período.
 */
export function eventWindow(
  event: EventTiming,
  timeZone: string,
): { start: Date; end: Date; allDay: boolean } {
  if (!parseTime(event.startTime)) {
    return {
      start: event.startDate,
      end: event.endDate ?? event.startDate,
      allDay: true,
    };
  }

  const start = event.startDate;
  const endTime = parseTime(event.endTime);

  if (endTime) {
    let end = zonedDate(localDate(start, timeZone), endTime, timeZone);

    if (end.getTime() <= start.getTime()) {
      end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    }

    return { start, end, allDay: false };
  }

  const minutes =
    event.duration && event.duration > 0
      ? event.duration
      : DEFAULT_DURATION_MINUTES;

  return {
    start,
    end: new Date(start.getTime() + minutes * 60_000),
    allDay: false,
  };
}

/** As cores do legado, por tipo — e verde claro para evento gratuito. */
export function colorsFor(type: EventType, isFree: boolean) {
  if (isFree) {
    return {
      backgroundColor: '#34D399',
      borderColor: '#10B981',
      textColor: '#000000',
    };
  }

  const byType: Partial<Record<EventType, [string, string]>> = {
    OPERA: ['#8B5CF6', '#7C3AED'],
    RECITAL: ['#EC4899', '#DB2777'],
    CHAMBER_MUSIC: ['#10B981', '#059669'],
    OPEN_REHEARSAL: ['#6B7280', '#4B5563'],
  };

  const [backgroundColor, borderColor] = byType[type] ?? ['#3B82F6', '#1D4ED8'];

  return { backgroundColor, borderColor, textColor: '#FFFFFF' };
}
