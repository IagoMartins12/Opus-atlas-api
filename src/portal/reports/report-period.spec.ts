import { BadRequestException } from '@nestjs/common';
import { resolvePeriod } from './report-period';

describe('resolvePeriod', () => {
  it('usa seis meses por padrão', () => {
    const period = resolvePeriod({});

    const months =
      (period.end.getFullYear() - period.start.getFullYear()) * 12 +
      (period.end.getMonth() - period.start.getMonth());

    expect(months).toBe(6);
    expect(period.label).toBe('6months');
  });

  it('monta a janela anterior de mesma duração', () => {
    const period = resolvePeriod({ period: '1month' });

    const atual = period.end.getTime() - period.start.getTime();
    const anterior =
      period.previous.end.getTime() - period.previous.start.getTime();

    expect(Math.abs(atual - anterior)).toBeLessThan(1000);
    expect(period.previous.end.getTime()).toBeLessThan(period.start.getTime());
  });

  // O legado fazia `now.setTime(...)` com a data final personalizada, mutando a
  // variável que o resto da geração usava como "agora".
  it('a data final não vira o relógio da geração', () => {
    const antes = Date.now();

    const period = resolvePeriod({
      from: '2020-01-01T00:00:00.000Z',
      to: '2020-06-01T00:00:00.000Z',
    });

    expect(period.end.toISOString()).toBe('2020-06-01T00:00:00.000Z');
    expect(Date.now()).toBeGreaterThanOrEqual(antes);
  });

  it('recusa data inválida', () => {
    expect(() => resolvePeriod({ from: 'ontem' })).toThrow(BadRequestException);
    expect(() =>
      resolvePeriod({ from: '2026-01-01T00:00:00.000Z', to: 'amanhã' }),
    ).toThrow(BadRequestException);
  });

  it('recusa período invertido', () => {
    expect(() =>
      resolvePeriod({
        from: '2026-06-01T00:00:00.000Z',
        to: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow(BadRequestException);
  });

  it('recusa janela acima do teto', () => {
    expect(() =>
      resolvePeriod({
        from: '2000-01-01T00:00:00.000Z',
        to: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow(BadRequestException);
  });

  // No legado, `all` era `new Date('2020-01-01')` — um recorte fixo que
  // envelhece sozinho.
  it('`all` ancora no início do vínculo, não numa data fixa', () => {
    const inicio = new Date();
    inicio.setMonth(inicio.getMonth() - 4);

    const period = resolvePeriod({ period: 'all', relationshipStart: inicio });

    expect(period.start.getTime()).toBe(inicio.getTime());
    expect(period.label).toBe('all');
  });

  it('`all` respeita o teto quando o vínculo é antigo demais', () => {
    const period = resolvePeriod({
      period: 'all',
      relationshipStart: new Date('2001-01-01T00:00:00.000Z'),
    });

    const dias =
      (period.end.getTime() - period.start.getTime()) / (24 * 60 * 60 * 1000);

    expect(dias).toBeLessThanOrEqual(366 * 3 + 1);
  });
});
