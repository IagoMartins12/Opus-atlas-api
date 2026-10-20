import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  churnRate,
  monthlyRevenueCents,
  movements,
  sumMrr,
  type SubscriptionMrr,
} from './mrr-math';

/** `AAAA-MM-DD` em UTC. */
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const monthOf = (day: string) => day.slice(0, 7);

const addMonths = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export interface MrrMonth {
  month: string;
  /** O MRR no fim do mês (o último retrato dele); `null` sem retrato. */
  mrrCents: number | null;
  active: number | null;
  newCents: number;
  expansionCents: number;
  contractionCents: number;
  churnCents: number;
  netNewCents: number;
  /** Cancelamento sobre o MRR com que o mês começou. */
  churnRate: number | null;
}

/**
 * O MRR guardado dia a dia.
 *
 * **Não dá para reconstruí-lo do passado**: uma troca de plano reescreve o
 * preço na própria assinatura, e o histórico não guarda o ciclo. Então um
 * retrato por dia guarda o total e o valor de cada assinatura, e o que entrou,
 * cresceu, encolheu e saiu num mês é a diferença entre dois retratos.
 *
 * Conta só assinatura `ACTIVE` e paga. Quem está em teste ou atrasado aparece
 * à parte (ainda não paga, ou está em risco).
 */
@Injectable()
export class MrrService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tira (ou refaz) o retrato de um dia; o último do dia é o que vale. */
  async takeSnapshot(at: Date = new Date()) {
    const [subs, trial, pastDue, teachers] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { status: 'ACTIVE', planType: { not: 'FREE' } },
        select: { id: true, price: true, billingPeriod: true, planType: true },
      }),
      this.prisma.subscription.count({ where: { status: 'TRIAL' } }),
      this.prisma.subscription.count({ where: { status: 'PAST_DUE' } }),
      this.prisma.teacher.count({ where: { status: 'ACTIVE' } }),
    ]);

    const perSub: SubscriptionMrr = {};
    const byPlan: Record<string, number> = {};
    for (const s of subs) {
      perSub[s.id] = monthlyRevenueCents(s.price ?? 0, s.billingPeriod ?? null);
      byPlan[s.planType] = (byPlan[s.planType] ?? 0) + 1;
    }

    const data = {
      mrrCents: sumMrr(perSub),
      active: subs.length,
      trial,
      pastDue,
      teachers,
      byPlan,
      subs: perSub,
    };
    const day = dayKey(at);
    return this.prisma.mrrSnapshot.upsert({
      where: { day },
      create: { day, ...data },
      update: data,
    });
  }

  /** O retrato de hoje, se ainda não houver (o job diário pode não ter rodado). */
  async ensureToday() {
    const day = dayKey(new Date());
    const existing = await this.prisma.mrrSnapshot.findUnique({
      where: { day },
    });
    return existing ?? this.takeSnapshot();
  }

  /**
   * Os últimos `months` meses (o atual por último): MRR no fim de cada um e a
   * ponte contra o mês anterior. O primeiro mês com retrato parte do zero:
   * tudo o que já existia ali conta como novo, e `since` diz de quando é o
   * primeiro retrato.
   */
  async series(months = 12) {
    await this.ensureToday();
    const current = monthOf(dayKey(new Date()));
    const first = addMonths(current, -(months - 1));

    const snapshots = await this.prisma.mrrSnapshot.findMany({
      where: { day: { gte: `${addMonths(first, -1)}-01` } },
      orderBy: { day: 'asc' },
      select: { day: true, mrrCents: true, active: true, subs: true },
    });
    const earliest = await this.prisma.mrrSnapshot.findFirst({
      orderBy: { day: 'asc' },
      select: { day: true },
    });

    // O último retrato de cada mês.
    const lastOf = new Map<string, (typeof snapshots)[number]>();
    for (const snap of snapshots) lastOf.set(monthOf(snap.day), snap);

    const result: MrrMonth[] = [];
    let previous: (typeof snapshots)[number] | undefined = lastOf.get(
      addMonths(first, -1),
    );

    for (let i = 0; i < months; i++) {
      const month = addMonths(first, i);
      const snap = lastOf.get(month);
      const before = (previous?.subs ?? {}) as SubscriptionMrr;

      if (!snap) {
        // Sem retrato (antes do primeiro, ou um dia em que ninguém abriu):
        // sem número, e o próximo mês compara com o último que existe.
        result.push({
          month,
          mrrCents: null,
          active: null,
          newCents: 0,
          expansionCents: 0,
          contractionCents: 0,
          churnCents: 0,
          netNewCents: 0,
          churnRate: null,
        });
        continue;
      }

      const bridge = movements(before, snap.subs as SubscriptionMrr);
      result.push({
        month,
        mrrCents: snap.mrrCents,
        active: snap.active,
        newCents: bridge.newCents,
        expansionCents: bridge.expansionCents,
        contractionCents: bridge.contractionCents,
        churnCents: bridge.churnCents,
        netNewCents: bridge.netNewCents,
        churnRate: churnRate(sumMrr(before), bridge.churnCents),
      });
      previous = snap;
    }

    return { since: earliest?.day ?? null, months: result };
  }
}
