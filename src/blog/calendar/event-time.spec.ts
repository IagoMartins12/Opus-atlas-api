import {
  colorsFor,
  eventWindow,
  localDate,
  parseTime,
  timeZoneOf,
  zonedDate,
} from './event-time';

describe('timeZoneOf', () => {
  it('Belém e Rio em −3, Manaus em −4', () => {
    expect(timeZoneOf('PA')).toBe('America/Belem');
    expect(timeZoneOf('rj')).toBe('America/Sao_Paulo');
    expect(timeZoneOf('AM')).toBe('America/Manaus');
  });

  it('UF desconhecida cai no horário de Brasília', () => {
    expect(timeZoneOf('XX')).toBe('America/Sao_Paulo');
    expect(timeZoneOf(null)).toBe('America/Sao_Paulo');
  });
});

describe('parseTime', () => {
  it.each([
    ['19:30', '19:30'],
    ['9:05', '09:05'],
    ['19h', '19:00'],
    ['19h30', '19:30'],
  ])('%j vira %j', (input, expected) => {
    expect(parseTime(input)).toBe(expected);
  });

  it.each(['', null, 'noite', '25:00', '19:75'])(
    '%j não é horário',
    (input) => {
      expect(parseTime(input)).toBeNull();
    },
  );
});

describe('zonedDate e localDate', () => {
  it('19h em São Paulo é 22h UTC', () => {
    expect(
      zonedDate('2026-09-11', '19:00', 'America/Sao_Paulo').toISOString(),
    ).toBe('2026-09-11T22:00:00.000Z');
  });

  it('19h em Manaus é 23h UTC', () => {
    expect(
      zonedDate('2026-09-11', '19:00', 'America/Manaus').toISOString(),
    ).toBe('2026-09-11T23:00:00.000Z');
  });

  it('a data local de 01h UTC em São Paulo ainda é o dia anterior', () => {
    expect(
      localDate(new Date('2026-09-12T01:00:00Z'), 'America/Sao_Paulo'),
    ).toBe('2026-09-11');
  });
});

describe('eventWindow', () => {
  // Medido na base: 19h em Brasília gravado como 22:00Z.
  const start = new Date('2026-09-11T22:00:00Z');

  // O legado fazia setHours(19, 0) no fuso do servidor: em UTC, 16h de Brasília.
  it('o início é o instante gravado, sem refazer o horário', () => {
    const window = eventWindow(
      {
        startDate: start,
        startTime: '19:00',
        endDate: null,
        endTime: null,
        duration: null,
      },
      'America/Sao_Paulo',
    );

    expect(window.start.toISOString()).toBe('2026-09-11T22:00:00.000Z');
    expect(window.allDay).toBe(false);
  });

  it('sem fim, dura duas horas', () => {
    const window = eventWindow(
      {
        startDate: start,
        startTime: '19:00',
        endDate: null,
        endTime: null,
        duration: null,
      },
      'America/Sao_Paulo',
    );

    expect(window.end.toISOString()).toBe('2026-09-12T00:00:00.000Z');
  });

  // O legado ignorava o endTime.
  it('com endTime, termina na hora local informada', () => {
    const window = eventWindow(
      {
        startDate: start,
        startTime: '19:00',
        endDate: null,
        endTime: '21:30',
        duration: null,
      },
      'America/Sao_Paulo',
    );

    expect(window.end.toISOString()).toBe('2026-09-12T00:30:00.000Z');
  });

  it('endTime antes do início passa para o dia seguinte', () => {
    const window = eventWindow(
      {
        startDate: start,
        startTime: '19:00',
        endDate: null,
        endTime: '01:00',
        duration: null,
      },
      'America/Sao_Paulo',
    );

    expect(window.end.toISOString()).toBe('2026-09-12T04:00:00.000Z');
  });

  it('usa a duração quando não há endTime', () => {
    const window = eventWindow(
      {
        startDate: start,
        startTime: '19:00',
        endDate: null,
        endTime: null,
        duration: 90,
      },
      'America/Sao_Paulo',
    );

    expect(window.end.toISOString()).toBe('2026-09-11T23:30:00.000Z');
  });

  // "Wicked, 15/07 a 04/10": temporada, não sessão.
  it('sem horário, é temporada de dia inteiro', () => {
    const seasonEnd = new Date('2026-10-04T03:00:00Z');
    const window = eventWindow(
      {
        startDate: start,
        startTime: null,
        endDate: seasonEnd,
        endTime: null,
        duration: null,
      },
      'America/Sao_Paulo',
    );

    expect(window).toEqual({ start, end: seasonEnd, allDay: true });
  });
});

describe('colorsFor', () => {
  it('ópera em roxo, gratuito em verde claro', () => {
    expect(colorsFor('OPERA', false).backgroundColor).toBe('#8B5CF6');
    expect(colorsFor('OPERA', true)).toEqual({
      backgroundColor: '#34D399',
      borderColor: '#10B981',
      textColor: '#000000',
    });
  });

  it('tipo sem cor própria fica azul', () => {
    expect(colorsFor('BALLET', false).backgroundColor).toBe('#3B82F6');
  });
});
