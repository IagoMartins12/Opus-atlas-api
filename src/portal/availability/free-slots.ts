import { localDate, zonedDate } from '../../common/utils/time-zone';

/**
 * Horas livres do professor: agenda semanal − bloqueios − aulas.
 *
 * Tudo em instantes (UTC) depois de expandido: a agenda é declarada em hora
 * local, no fuso do professor, e cada dia do período vira intervalos concretos
 * pelo `zonedDate` — que acerta o deslocamento de cada data, inclusive se o
 * fuso tiver horário de verão.
 */

export interface WeeklySlot {
  weekday: number;
  startTime: string;
  endTime: string;
}

export interface Interval {
  start: Date;
  end: Date;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** `"08:30"` → 510. Aceita só `HH:mm` de 00:00 a 23:59; o resto é `null`. */
export function minutesOf(hhmm: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * Problemas de uma agenda semanal, em português, para o 400.
 *
 * Janela que termina antes de começar, fora do formato, ou sobreposta a outra
 * do mesmo dia — sobreposição contaria a mesma hora duas vezes.
 */
export function weeklyProblems(slots: WeeklySlot[]): string[] {
  const problems: string[] = [];
  const byDay = new Map<number, Array<[number, number]>>();

  slots.forEach((slot, index) => {
    const start = minutesOf(slot.startTime);
    const end = minutesOf(slot.endTime);

    if (
      !Number.isInteger(slot.weekday) ||
      slot.weekday < 0 ||
      slot.weekday > 6
    ) {
      problems.push(
        `janela ${index + 1}: dia da semana vai de 0 (domingo) a 6`,
      );
      return;
    }

    if (start === null || end === null) {
      problems.push(`janela ${index + 1}: horário no formato HH:mm`);
      return;
    }

    if (end <= start) {
      problems.push(
        `janela ${index + 1}: termina antes de começar (quem atende depois da meia-noite declara duas janelas)`,
      );
      return;
    }

    const day = byDay.get(slot.weekday) ?? [];
    const clash = day.find(([s, e]) => start < e && s < end);

    if (clash) {
      problems.push(`janela ${index + 1}: sobrepõe outra do mesmo dia`);
    }

    day.push([start, end]);
    byDay.set(slot.weekday, day);
  });

  return problems;
}

/** Dia da semana de uma data `YYYY-MM-DD` (0 = domingo). */
function weekdayOf(ymd: string): number {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function nextDay(ymd: string): string {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) + DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** A agenda semanal como intervalos concretos dentro de `[from, to)`. */
export function expandWeekly(
  slots: WeeklySlot[],
  from: Date,
  to: Date,
  timeZone: string,
): Interval[] {
  const intervals: Interval[] = [];

  if (slots.length === 0 || to <= from) {
    return intervals;
  }

  const lastDay = localDate(to, timeZone);

  for (
    let ymd = localDate(from, timeZone);
    ymd <= lastDay;
    ymd = nextDay(ymd)
  ) {
    const weekday = weekdayOf(ymd);

    for (const slot of slots) {
      if (slot.weekday !== weekday) continue;

      const start = zonedDate(ymd, slot.startTime, timeZone);
      const end = zonedDate(ymd, slot.endTime, timeZone);
      const clipped = {
        start: start < from ? from : start,
        end: end > to ? to : end,
      };

      if (clipped.end > clipped.start) {
        intervals.push(clipped);
      }
    }
  }

  return intervals.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** `base` sem os trechos cobertos por `busy`. */
export function subtract(base: Interval[], busy: Interval[]): Interval[] {
  const sortedBusy = [...busy].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  const result: Interval[] = [];

  for (const interval of base) {
    let cursor = interval.start;

    for (const block of sortedBusy) {
      if (block.end <= cursor || block.start >= interval.end) continue;

      if (block.start > cursor) {
        result.push({ start: cursor, end: block.start });
      }

      if (block.end > cursor) {
        cursor = block.end;
      }

      if (cursor >= interval.end) break;
    }

    if (cursor < interval.end) {
      result.push({ start: cursor, end: interval.end });
    }
  }

  return result;
}

export interface FreeTimeInput {
  slots: WeeklySlot[];
  blocks: Interval[];
  lessons: Array<{ scheduledAt: Date; duration: number }>;
  from: Date;
  to: Date;
  timeZone: string;
  /** Tempo livre antes de agora não se vende mais: a conta começa aqui. */
  now: Date;
  /** Sobras menores que isto não são oferecidas como horário livre. */
  minMinutes?: number;
}

/**
 * Horários livres e o total em horas, dentro de `[max(from, now), to)`.
 *
 * Sem agenda declarada, `hours` é `null` — "zero horas livres" e "não sei" são
 * respostas diferentes, e o legado respondia a segunda com um número inventado.
 */
export function freeTime(input: FreeTimeInput): {
  slots: Interval[];
  hours: number | null;
} {
  if (input.slots.length === 0) {
    return { slots: [], hours: null };
  }

  const start = input.now > input.from ? input.now : input.from;
  const available = expandWeekly(input.slots, start, input.to, input.timeZone);
  const busy = [
    ...input.blocks,
    ...input.lessons.map((lesson) => ({
      start: lesson.scheduledAt,
      end: new Date(lesson.scheduledAt.getTime() + lesson.duration * MINUTE_MS),
    })),
  ];

  const minMs = (input.minMinutes ?? 0) * MINUTE_MS;
  const free = subtract(available, busy).filter(
    (slot) => slot.end.getTime() - slot.start.getTime() >= Math.max(minMs, 1),
  );
  const minutes =
    free.reduce(
      (total, slot) => total + (slot.end.getTime() - slot.start.getTime()),
      0,
    ) / MINUTE_MS;

  return { slots: free, hours: Math.round((minutes / 60) * 10) / 10 };
}
