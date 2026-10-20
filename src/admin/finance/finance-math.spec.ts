import {
  addMonths,
  breakEven,
  monthEnd,
  monthKey,
  monthlyEquivalentCents,
  monthlyRevenueCents,
  monthsFrom,
  monthStart,
  occurrencesBetween,
  type EntryShape,
} from './finance-math';

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

const entry = (over: Partial<EntryShape> = {}): EntryShape => ({
  kind: 'ONCE',
  amountCents: 10_000,
  fxRate: 1,
  startDate: d('2026-11-10'),
  installments: null,
  intervalMonths: null,
  endDate: null,
  pausedAt: null,
  ...over,
});

const range = (from: string, to: string) =>
  [monthStart(from), monthEnd(to)] as const;

describe('meses', () => {
  it('chave, início e fim exclusivo', () => {
    expect(monthKey(d('2026-02-28'))).toBe('2026-02');
    expect(monthStart('2026-12').toISOString()).toBe(
      '2026-12-01T00:00:00.000Z',
    );
    expect(monthEnd('2026-12').toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('31 de janeiro mais um mês é o fim de fevereiro', () => {
    expect(addMonths(d('2026-01-31'), 1).toISOString().slice(0, 10)).toBe(
      '2026-02-28',
    );
  });

  it('a lista de meses atravessa o ano', () => {
    expect(monthsFrom('2026-11', 3)).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

describe('occurrencesBetween', () => {
  it('único cai no mês dele, e só nele', () => {
    expect(
      occurrencesBetween(entry(), ...range('2026-11', '2026-11')),
    ).toHaveLength(1);
    expect(
      occurrencesBetween(entry(), ...range('2026-12', '2026-12')),
    ).toHaveLength(0);
  });

  it('converte pela cotação guardada no lançamento', () => {
    const [o] = occurrencesBetween(
      entry({ amountCents: 2_000, fxRate: 5.1 }),
      ...range('2026-11', '2026-11'),
    );
    expect(o.brlCents).toBe(10_200);
  });

  it('parcelado divide o total e põe o resto na primeira parcela', () => {
    const all = occurrencesBetween(
      entry({ kind: 'INSTALLMENTS', amountCents: 10_000, installments: 3 }),
      ...range('2026-11', '2027-03'),
    );
    expect(all.map((o) => o.brlCents)).toEqual([3_334, 3_333, 3_333]);
    expect(all.reduce((s, o) => s + o.brlCents, 0)).toBe(10_000);
    expect(all[2].installment).toEqual({ n: 3, of: 3 });
  });

  it('recorrente mensal sem fim conta mês a mês', () => {
    const all = occurrencesBetween(
      entry({ kind: 'RECURRING', intervalMonths: 1 }),
      ...range('2026-11', '2027-02'),
    );
    expect(all).toHaveLength(4);
  });

  it('recorrente anual cobra uma vez por ano', () => {
    const all = occurrencesBetween(
      entry({ kind: 'RECURRING', intervalMonths: 12 }),
      ...range('2026-11', '2028-12'),
    );
    expect(all.map((o) => monthKey(o.date))).toEqual([
      '2026-11',
      '2027-11',
      '2028-11',
    ]);
  });

  it('o fim e a pausa param a contagem', () => {
    const fim = occurrencesBetween(
      entry({ kind: 'RECURRING', intervalMonths: 1, endDate: d('2026-12-15') }),
      ...range('2026-11', '2027-06'),
    );
    expect(fim).toHaveLength(2);

    const pausado = occurrencesBetween(
      entry({
        kind: 'RECURRING',
        intervalMonths: 1,
        pausedAt: d('2027-01-01'),
      }),
      ...range('2026-11', '2027-06'),
    );
    expect(pausado.map((o) => monthKey(o.date))).toEqual([
      '2026-11',
      '2026-12',
    ]);
  });
});

describe('equivalentes mensais', () => {
  it('anual do lançamento vale 1/12; único não é fixo', () => {
    expect(
      monthlyEquivalentCents(
        entry({ kind: 'RECURRING', intervalMonths: 12, amountCents: 12_000 }),
      ),
    ).toBe(1_000);
    expect(monthlyEquivalentCents(entry())).toBe(0);
  });

  it('a assinatura anual vale 1/12 por mês', () => {
    expect(monthlyRevenueCents(399.9, 'YEARLY')).toBe(3_333);
    expect(monthlyRevenueCents(39.9, 'MONTHLY')).toBe(3_990);
  });
});

describe('breakEven', () => {
  it('quantos assinantes cobrem o custo fixo no preço médio de hoje', () => {
    const r = breakEven(100_000, 40_000, 10); // ticket de 40,00
    expect(r.subscribersNeeded).toBe(25);
    expect(r.coveredShare).toBeCloseTo(0.4);
  });

  it('sem assinantes não há preço médio', () => {
    expect(breakEven(100_000, 0, 0).subscribersNeeded).toBeNull();
  });

  it('sem custo, já está coberto', () => {
    expect(breakEven(0, 0, 0).coveredShare).toBe(1);
  });
});
