import {
  expandWeekly,
  freeTime,
  minutesOf,
  subtract,
  weeklyProblems,
} from './free-slots';

const SP = 'America/Sao_Paulo';
const MANAUS = 'America/Manaus';

// Segunda, 14/09/2026, meia-noite em São Paulo (03:00Z).
const MONDAY = new Date('2026-09-14T03:00:00Z');
const WEEK_END = new Date('2026-09-21T03:00:00Z');

describe('minutesOf', () => {
  it('HH:mm válido', () => {
    expect(minutesOf('08:30')).toBe(510);
    expect(minutesOf('23:59')).toBe(1439);
  });

  it('o resto é null', () => {
    expect(minutesOf('24:00')).toBeNull();
    expect(minutesOf('8:30')).toBeNull();
    expect(minutesOf('08h30')).toBeNull();
  });
});

describe('weeklyProblems', () => {
  it('agenda válida não tem problema', () => {
    expect(
      weeklyProblems([
        { weekday: 1, startTime: '08:00', endTime: '12:00' },
        { weekday: 1, startTime: '14:00', endTime: '18:00' },
      ]),
    ).toEqual([]);
  });

  // Sobreposta, a mesma hora contaria duas vezes nas horas livres.
  it('recusa sobreposição no mesmo dia', () => {
    expect(
      weeklyProblems([
        { weekday: 1, startTime: '08:00', endTime: '12:00' },
        { weekday: 1, startTime: '11:00', endTime: '13:00' },
      ]),
    ).toEqual(['janela 2: sobrepõe outra do mesmo dia']);
  });

  it('recusa janela invertida, dia fora da semana e formato errado', () => {
    const problems = weeklyProblems([
      { weekday: 1, startTime: '18:00', endTime: '08:00' },
      { weekday: 7, startTime: '08:00', endTime: '09:00' },
      { weekday: 2, startTime: '8h', endTime: '09:00' },
    ]);

    expect(problems).toHaveLength(3);
  });
});

describe('expandWeekly', () => {
  it('a segunda das 8h às 12h vira um intervalo no fuso do professor', () => {
    const [slot] = expandWeekly(
      [{ weekday: 1, startTime: '08:00', endTime: '12:00' }],
      MONDAY,
      WEEK_END,
      SP,
    );

    expect(slot.start.toISOString()).toBe('2026-09-14T11:00:00.000Z');
    expect(slot.end.toISOString()).toBe('2026-09-14T15:00:00.000Z');
  });

  // Manaus é −4: a mesma hora local é uma hora depois em UTC.
  it('respeita o fuso de cada professor', () => {
    const [slot] = expandWeekly(
      [{ weekday: 1, startTime: '08:00', endTime: '12:00' }],
      MONDAY,
      WEEK_END,
      MANAUS,
    );

    expect(slot.start.toISOString()).toBe('2026-09-14T12:00:00.000Z');
  });

  it('corta nas pontas do período', () => {
    const [slot] = expandWeekly(
      [{ weekday: 1, startTime: '08:00', endTime: '12:00' }],
      new Date('2026-09-14T13:00:00Z'),
      WEEK_END,
      SP,
    );

    expect(slot.start.toISOString()).toBe('2026-09-14T13:00:00.000Z');
  });

  it('uma semana com duas janelas diárias de segunda a sexta', () => {
    const slots = [1, 2, 3, 4, 5].flatMap((weekday) => [
      { weekday, startTime: '08:00', endTime: '12:00' },
      { weekday, startTime: '14:00', endTime: '18:00' },
    ]);

    expect(expandWeekly(slots, MONDAY, WEEK_END, SP)).toHaveLength(10);
  });
});

describe('subtract', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 8, 14, h));

  it('tira o miolo, as pontas e o que cobre tudo', () => {
    const base = [{ start: at(8), end: at(12) }];

    expect(subtract(base, [{ start: at(9), end: at(10) }])).toEqual([
      { start: at(8), end: at(9) },
      { start: at(10), end: at(12) },
    ]);
    expect(subtract(base, [{ start: at(7), end: at(9) }])).toEqual([
      { start: at(9), end: at(12) },
    ]);
    expect(subtract(base, [{ start: at(6), end: at(13) }])).toEqual([]);
  });

  it('ocupações sobrepostas não geram sobra fantasma', () => {
    const base = [{ start: at(8), end: at(12) }];

    expect(
      subtract(base, [
        { start: at(9), end: at(11) },
        { start: at(10), end: at(10) },
        { start: at(8), end: at(9) },
      ]),
    ).toEqual([{ start: at(11), end: at(12) }]);
  });
});

describe('freeTime', () => {
  const slots = [{ weekday: 1, startTime: '08:00', endTime: '12:00' }];

  // O legado inventava 5 dias de 8 horas.
  it('sem agenda declarada, horas é null, não um número inventado', () => {
    expect(
      freeTime({
        slots: [],
        blocks: [],
        lessons: [],
        from: MONDAY,
        to: WEEK_END,
        timeZone: SP,
        now: MONDAY,
      }),
    ).toEqual({ slots: [], hours: null });
  });

  it('desconta a aula marcada', () => {
    const result = freeTime({
      slots,
      blocks: [],
      lessons: [
        { scheduledAt: new Date('2026-09-14T12:00:00Z'), duration: 60 },
      ],
      from: MONDAY,
      to: WEEK_END,
      timeZone: SP,
      now: MONDAY,
    });

    expect(result.hours).toBe(3);
    expect(result.slots).toHaveLength(2);
  });

  it('desconta o bloqueio (férias)', () => {
    const result = freeTime({
      slots,
      blocks: [{ start: MONDAY, end: WEEK_END }],
      lessons: [],
      from: MONDAY,
      to: WEEK_END,
      timeZone: SP,
      now: MONDAY,
    });

    expect(result).toEqual({ slots: [], hours: 0 });
  });

  // Tempo livre que já passou não se oferece a ninguém.
  it('começa a contar de agora', () => {
    const result = freeTime({
      slots,
      blocks: [],
      lessons: [],
      from: MONDAY,
      to: WEEK_END,
      timeZone: SP,
      now: new Date('2026-09-14T13:00:00Z'),
    });

    expect(result.hours).toBe(2);
  });

  it('descarta sobra menor que o mínimo pedido', () => {
    const result = freeTime({
      slots,
      blocks: [],
      lessons: [
        { scheduledAt: new Date('2026-09-14T11:20:00Z'), duration: 220 },
      ],
      from: MONDAY,
      to: WEEK_END,
      timeZone: SP,
      now: MONDAY,
      minMinutes: 30,
    });

    expect(result.slots).toEqual([]);
  });
});
