/**
 * As contas do MRR (receita mensal recorrente), sem banco. Dinheiro em
 * centavos inteiros.
 */

/** O que uma assinatura vale por mês: a anual vale 1/12. */
export function monthlyRevenueCents(
  priceReais: number,
  period: 'MONTHLY' | 'YEARLY' | null,
): number {
  const cents = Math.round(priceReais * 100);
  return period === 'YEARLY' ? Math.round(cents / 12) : cents;
}

/** `{ subscriptionId: centavos por mês }`: o MRR de cada assinatura. */
export type SubscriptionMrr = Record<string, number>;

export interface MrrMovements {
  /** Assinaturas que não existiam no retrato anterior. */
  newCents: number;
  newCount: number;
  /** Quem já pagava e passou a valer mais (upgrade, troca para o anual). */
  expansionCents: number;
  /** Quem já pagava e passou a valer menos (descida de plano). */
  contractionCents: number;
  /** Quem pagava e saiu (cancelou, expirou, não pagou). Positivo. */
  churnCents: number;
  churnCount: number;
  /** Novo + expansão − contração − cancelamento. */
  netNewCents: number;
}

/**
 * A "ponte" entre dois retratos: o que entrou, cresceu, encolheu e saiu.
 * Compara assinatura por assinatura, e é por isso que é exata — a soma das
 * quatro pontas fecha com a diferença entre os dois totais.
 */
export function movements(
  before: SubscriptionMrr,
  after: SubscriptionMrr,
): MrrMovements {
  const out: MrrMovements = {
    newCents: 0,
    newCount: 0,
    expansionCents: 0,
    contractionCents: 0,
    churnCents: 0,
    churnCount: 0,
    netNewCents: 0,
  };

  for (const [id, cents] of Object.entries(after)) {
    const previous = before[id];
    if (previous === undefined) {
      out.newCents += cents;
      out.newCount++;
    } else if (cents > previous) {
      out.expansionCents += cents - previous;
    } else if (cents < previous) {
      out.contractionCents += previous - cents;
    }
  }

  for (const [id, cents] of Object.entries(before)) {
    if (after[id] === undefined) {
      out.churnCents += cents;
      out.churnCount++;
    }
  }

  out.netNewCents =
    out.newCents + out.expansionCents - out.contractionCents - out.churnCents;
  return out;
}

export const sumMrr = (subs: SubscriptionMrr) =>
  Object.values(subs).reduce((total, cents) => total + cents, 0);

/** Cancelamento do mês sobre o MRR com que o mês começou; `null` sem base. */
export function churnRate(
  openingCents: number,
  churnCents: number,
): number | null {
  return openingCents > 0 ? churnCents / openingCents : null;
}
