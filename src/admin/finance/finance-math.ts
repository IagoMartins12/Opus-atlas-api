/**
 * As contas do painel financeiro, sem banco: um lançamento vira as datas em
 * que cobra, o mês vira um intervalo, a assinatura vira receita por mês.
 * Dinheiro é sempre inteiro em centavos — nunca ponto flutuante.
 */

export type EntryKind = 'ONCE' | 'INSTALLMENTS' | 'RECURRING';

export interface EntryShape {
  kind: EntryKind;
  amountCents: number;
  /** BRL por unidade da moeda do lançamento (1 para BRL). */
  fxRate: number;
  startDate: Date;
  installments: number | null;
  intervalMonths: number | null;
  endDate: Date | null;
  pausedAt: Date | null;
}

export interface Occurrence {
  date: Date;
  /** Em centavos de real, já convertido pela cotação do lançamento. */
  brlCents: number;
  /** Parcela `n` de `of` (só em parcelado). */
  installment?: { n: number; of: number };
}

/** `AAAA-MM`, em UTC: o mês é decisão do dia civil, não do fuso do servidor. */
export const monthKey = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

export const monthStart = (key: string) => {
  const [year, month] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
};

/** O primeiro instante do mês seguinte (o fim é exclusivo). */
export const monthEnd = (key: string) => {
  const start = monthStart(key);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
};

export const addMonths = (date: Date, months: number) => {
  const day = date.getUTCDate();
  const target = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + months,
      1,
      date.getUTCHours(),
      date.getUTCMinutes(),
    ),
  );
  // 31 de janeiro + 1 mês é o último dia de fevereiro, não 3 de março.
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
};

const toBrl = (cents: number, fxRate: number) => Math.round(cents * fxRate);

/** Teto de ocorrências: um recorrente sem fim não gera lista infinita. */
const MAX_OCCURRENCES = 600;

/**
 * Todas as cobranças de um lançamento que caem em `[from, to)`.
 *
 *  - único: a data;
 *  - parcelado: `amountCents` é o **total**, dividido em `installments`
 *    parcelas mensais; o resto da divisão vai na primeira;
 *  - recorrente: a cada `intervalMonths`, do início até o fim (se houver) ou
 *    até ser pausado.
 */
export function occurrencesBetween(
  entry: EntryShape,
  from: Date,
  to: Date,
): Occurrence[] {
  const inside = (date: Date) => date >= from && date < to;
  const stopAt = (date: Date) => !!entry.pausedAt && date >= entry.pausedAt;

  if (entry.kind === 'ONCE') {
    return inside(entry.startDate) && !stopAt(entry.startDate)
      ? [
          {
            date: entry.startDate,
            brlCents: toBrl(entry.amountCents, entry.fxRate),
          },
        ]
      : [];
  }

  if (entry.kind === 'INSTALLMENTS') {
    const count = Math.max(1, entry.installments ?? 1);
    const base = Math.floor(entry.amountCents / count);
    const rest = entry.amountCents - base * count;
    const result: Occurrence[] = [];

    for (let n = 0; n < count; n++) {
      const date = addMonths(entry.startDate, n);
      if (!inside(date)) continue;
      result.push({
        date,
        brlCents: toBrl(base + (n === 0 ? rest : 0), entry.fxRate),
        installment: { n: n + 1, of: count },
      });
    }
    return result;
  }

  const step = Math.max(1, entry.intervalMonths ?? 1);
  const result: Occurrence[] = [];

  for (let i = 0; i < MAX_OCCURRENCES; i++) {
    const date = addMonths(entry.startDate, i * step);
    if (date >= to) break;
    if (entry.endDate && date > entry.endDate) break;
    if (stopAt(date)) break;
    if (date >= from) {
      result.push({ date, brlCents: toBrl(entry.amountCents, entry.fxRate) });
    }
  }
  return result;
}

/** O custo mensal de um recorrente (anual divide por 12), em centavos de real. */
export function monthlyEquivalentCents(entry: EntryShape): number {
  if (entry.kind !== 'RECURRING') return 0;
  const step = Math.max(1, entry.intervalMonths ?? 1);
  return Math.round(toBrl(entry.amountCents, entry.fxRate) / step);
}

export { monthlyRevenueCents } from '../../billing/services/mrr-math';

/**
 * Ponto de equilíbrio: quanto de receita mensal cobre o custo fixo, e
 * quantos assinantes isso dá no preço médio de hoje (`null` sem assinantes:
 * não há preço médio para dividir).
 */
export function breakEven(
  fixedMonthlyCostCents: number,
  mrrCents: number,
  subscribers: number,
): {
  mrrNeededCents: number;
  subscribersNeeded: number | null;
  coveredShare: number;
} {
  const ticket = subscribers > 0 ? mrrCents / subscribers : null;
  return {
    mrrNeededCents: fixedMonthlyCostCents,
    subscribersNeeded:
      ticket && ticket > 0 ? Math.ceil(fixedMonthlyCostCents / ticket) : null,
    coveredShare:
      fixedMonthlyCostCents > 0 ? mrrCents / fixedMonthlyCostCents : 1,
  };
}

/** Os `count` meses a partir de `from` (`AAAA-MM`). */
export function monthsFrom(from: string, count: number): string[] {
  const start = monthStart(from);
  return Array.from({ length: count }, (_, i) => monthKey(addMonths(start, i)));
}
