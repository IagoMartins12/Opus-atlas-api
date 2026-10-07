import {
  buildCalendar,
  foldLine,
  icsDate,
  icsText,
  type IcsLesson,
} from './ics';

const lesson = (over: Partial<IcsLesson> = {}): IcsLesson => ({
  id: 'l1',
  title: 'Noturno: pedal e rubato',
  scheduledAt: new Date('2026-10-08T18:00:00Z'),
  duration: 60,
  status: 'SCHEDULED',
  location: 'Estúdio',
  description: null,
  updatedAt: new Date('2026-10-01T12:00:00Z'),
  counterpart: 'com Marina Costa',
  url: 'https://opusatlas.test/teacher/lessons/l1',
  ...over,
});

describe('iCalendar', () => {
  it('data em UTC no formato do padrão', () => {
    expect(icsDate(new Date('2026-10-08T18:00:00.000Z'))).toBe(
      '20261008T180000Z',
    );
  });

  it('escapa vírgula, ponto e vírgula, barra e quebra de linha', () => {
    expect(icsText('a, b; c\\d\ne')).toBe('a\\, b\; c\\\\d\\ne');
  });

  // Acento ocupa dois bytes: cortar no meio de um caractere corrompe o texto.
  it('dobra por octetos sem partir caractere acentuado', () => {
    const folded = foldLine(`SUMMARY:${'é'.repeat(60)}`);
    const parts = folded.split('\r\n ');
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts)
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(parts.join('')).toBe(`SUMMARY:${'é'.repeat(60)}`);
  });

  it('UID estável e SEQUENCE da última mudança — a remarcação atualiza o evento', () => {
    const ics = buildCalendar({ name: 'Aulas', lessons: [lesson()] });
    expect(ics).toContain('UID:lesson-l1@opusatlas.com');
    expect(ics).toContain(
      `SEQUENCE:${Math.floor(Date.parse('2026-10-01T12:00:00Z') / 1000)}`,
    );
    expect(ics).toContain('DTSTART:20261008T180000Z');
    expect(ics).toContain('DTEND:20261008T190000Z');
    expect(ics).toContain('SUMMARY:Noturno: pedal e rubato — com Marina Costa');
  });

  // Sumir do feed nem sempre apaga o evento do lado de lá.
  it('aula cancelada sai como cancelada, não some', () => {
    const ics = buildCalendar({
      name: 'Aulas',
      lessons: [lesson({ status: 'CANCELLED' })],
    });
    expect(ics).toContain('STATUS:CANCELLED');
  });

  it('linhas terminam em CRLF, como o padrão pede', () => {
    const ics = buildCalendar({ name: 'Aulas', lessons: [] });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});
