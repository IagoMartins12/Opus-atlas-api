import { churnRate, monthlyRevenueCents, movements, sumMrr } from './mrr-math';

describe('monthlyRevenueCents', () => {
  it('anual vale 1/12 por mês; mensal vale o preço', () => {
    expect(monthlyRevenueCents(399.9, 'YEARLY')).toBe(3_333);
    expect(monthlyRevenueCents(39.9, 'MONTHLY')).toBe(3_990);
    expect(monthlyRevenueCents(39.9, null)).toBe(3_990);
  });
});

describe('movements', () => {
  it('quem chegou é novo; quem saiu é cancelamento', () => {
    const m = movements({ a: 3_990 }, { b: 7_990 });

    expect(m).toMatchObject({
      newCents: 7_990,
      newCount: 1,
      churnCents: 3_990,
      churnCount: 1,
      netNewCents: 4_000,
    });
  });

  it('quem ficou e passou a valer mais é expansão; a valer menos, contração', () => {
    const m = movements({ a: 3_990, b: 7_990 }, { a: 7_990, b: 3_990 });

    expect(m.expansionCents).toBe(4_000);
    expect(m.contractionCents).toBe(4_000);
    expect(m.netNewCents).toBe(0);
    expect(m.newCount + m.churnCount).toBe(0);
  });

  it('a ponte fecha: a diferença dos totais é o líquido', () => {
    const before = { a: 3_990, b: 7_990, c: 1_000 };
    const after = { a: 7_990, c: 1_000, d: 2_500 };

    expect(sumMrr(after) - sumMrr(before)).toBe(
      movements(before, after).netNewCents,
    );
  });

  it('sem retrato anterior, tudo é novo', () => {
    const m = movements({}, { a: 3_990, b: 3_990 });

    expect(m.newCents).toBe(7_980);
    expect(m.newCount).toBe(2);
  });

  it('nada muda, nada se move', () => {
    expect(movements({ a: 1 }, { a: 1 }).netNewCents).toBe(0);
  });
});

describe('churnRate', () => {
  it('cancelamento sobre o MRR do começo do mês', () => {
    expect(churnRate(10_000, 500)).toBeCloseTo(0.05);
  });

  it('sem base, não há taxa', () => {
    expect(churnRate(0, 0)).toBeNull();
  });
});
