import { Injectable } from '@nestjs/common';
import { PlanType } from '@prisma/client';
import { PLAN_FEATURES } from '../../billing/constants/plan-features.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogQualityService } from '../catalog/catalog-quality.service';
import { ReportData } from './report-types';

type Cell = string | number | null;
type Row = Cell[];

const TZ = 'America/Sao_Paulo';
const DAY_MS = 24 * 60 * 60 * 1000;

const day = (date: Date) => date.toLocaleDateString('sv-SE', { timeZone: TZ });
const money = (n: number | null | undefined) =>
  Math.round(((n ?? 0) + Number.EPSILON) * 100) / 100;
const pct = (part: number, total: number) =>
  total > 0 ? Math.round((part / total) * 1000) / 10 : 0;

/** Conta por chave: o groupBy do Prisma devolve formatos diferentes por modelo. */
function tally<T>(items: T[], key: (item: T) => string | null | undefined) {
  const out = new Map<string, number>();
  for (const item of items) {
    const k = key(item) ?? 'Não informado';
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]);
}

/** Série diária completa do período, com zero nos dias vazios. */
function dailySeries(dates: Date[], start: Date, end: Date): Row[] {
  const counts = new Map<string, number>();
  for (const d of dates) counts.set(day(d), (counts.get(day(d)) ?? 0) + 1);
  const rows: Row[] = [];
  const days = Math.min(
    Math.ceil((end.getTime() - start.getTime()) / DAY_MS),
    1100,
  );
  for (let i = 0; i <= days; i++) {
    const key = day(new Date(start.getTime() + i * DAY_MS));
    rows.push([key, counts.get(key) ?? 0]);
  }
  return rows;
}

const PLAN_NAME: Record<string, string> = {
  FREE: 'Free',
  PLUS: 'Plus',
  MENTOR: 'Mentor',
  MAESTRO: 'Maestro',
};
const STATUS_NAME: Record<string, string> = {
  PENDING: 'Aguardando checkout',
  TRIAL: 'Em teste',
  ACTIVE: 'Ativa',
  PAST_DUE: 'Em atraso',
  CANCELLED: 'Cancelada (com acesso)',
  EXPIRED: 'Encerrada',
};

/**
 * Os relatórios gerenciais do painel além dos três clássicos: receita e
 * assinaturas, qualidade e uso do acervo, ensino (professores e alunos),
 * aprendizado, comunidade, e-mail e newsletter, e aquisição e retenção.
 *
 * Cada um devolve o mesmo formato (`ReportData`: indicadores e tabelas), então
 * sai em CSV e em planilha com uma aba por tabela. **Só leitura, e só com o que
 * o banco guarda**: onde o dado não existe (retenção por sessão, por exemplo),
 * a tabela diz que é aproximação.
 */
@Injectable()
export class ReportSuiteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quality: CatalogQualityService,
  ) {}

  // ------------------------------------------------------------------
  async revenue(start: Date, end: Date): Promise<ReportData> {
    const period = { gte: start, lte: end };
    const [
      subs,
      payments,
      adjustments,
      history,
      snapshots,
      coupons,
      failures,
      latestMrr,
    ] = await Promise.all([
      this.prisma.subscription.findMany({
        select: {
          planType: true,
          status: true,
          billingPeriod: true,
          price: true,
          createdAt: true,
          cancelledAt: true,
        },
      }),
      this.prisma.payment.findMany({
        where: { createdAt: period },
        select: {
          status: true,
          finalAmount: true,
          currency: true,
          stripeFeeCents: true,
          paidAt: true,
          createdAt: true,
          subscription: { select: { planType: true, billingPeriod: true } },
        },
      }),
      this.prisma.paymentAdjustment.findMany({
        where: { at: period },
        select: { kind: true, amountCents: true, currency: true, at: true },
      }),
      this.prisma.subscriptionHistory.groupBy({
        by: ['action'],
        where: { createdAt: period },
        _count: { _all: true },
      }),
      this.prisma.mrrSnapshot.findMany({
        where: { day: { gte: day(start), lte: day(end) } },
        orderBy: { day: 'asc' },
        select: {
          day: true,
          mrrCents: true,
          active: true,
          trial: true,
          pastDue: true,
        },
      }),
      this.prisma.couponUsage.groupBy({
        by: ['couponId'],
        where: { usedAt: period },
        _count: { _all: true },
        _sum: { discountApplied: true },
      }),
      this.prisma.payment.findMany({
        where: { createdAt: period, status: 'REJECTED' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          createdAt: true,
          finalAmount: true,
          payerEmail: true,
          subscription: { select: { planType: true } },
        },
      }),
      // O último retrato de todos, não só o do período: "MRR atual" é de hoje.
      this.prisma.mrrSnapshot.findFirst({
        orderBy: { day: 'desc' },
        select: { mrrCents: true, day: true },
      }),
    ]);

    const approved = payments.filter((p) => p.status === 'APPROVED');
    const gross = approved.reduce((n, p) => n + p.finalAmount, 0);
    const fees =
      approved.reduce((n, p) => n + (p.stripeFeeCents ?? 0), 0) / 100;
    const refunds =
      adjustments
        .filter((a) => a.kind === 'REFUND')
        .reduce((n, a) => n + a.amountCents, 0) / 100;
    const disputes =
      adjustments
        .filter((a) => a.kind === 'DISPUTE' || a.kind === 'DISPUTE_FEE')
        .reduce((n, a) => n + a.amountCents, 0) / 100;
    const won =
      adjustments
        .filter((a) => a.kind === 'DISPUTE_WON')
        .reduce((n, a) => n + a.amountCents, 0) / 100;
    const live = subs.filter((s) =>
      ['TRIAL', 'ACTIVE', 'PAST_DUE'].includes(s.status),
    );
    const paying = subs.filter((s) =>
      ['ACTIVE', 'PAST_DUE'].includes(s.status),
    );
    const lastSnapshot = latestMrr;
    const act = (a: string) =>
      history.find((h) => h.action === a)?._count._all ?? 0;
    const newInPeriod = subs.filter(
      (s) =>
        s.createdAt >= start && s.createdAt <= end && s.planType !== 'FREE',
    ).length;

    const byPlanStatus = new Map<string, number>();
    for (const s of subs) {
      const k = `${PLAN_NAME[s.planType]}|${STATUS_NAME[s.status] ?? s.status}`;
      byPlanStatus.set(k, (byPlanStatus.get(k) ?? 0) + 1);
    }

    const revenueByPlan = new Map<string, { n: number; total: number }>();
    for (const p of approved) {
      const k = `${PLAN_NAME[p.subscription?.planType ?? 'FREE']}|${p.subscription?.billingPeriod === 'YEARLY' ? 'Anual' : 'Mensal'}`;
      const cur = revenueByPlan.get(k) ?? { n: 0, total: 0 };
      cur.n++;
      cur.total += p.finalAmount;
      revenueByPlan.set(k, cur);
    }

    const couponRows = await this.prisma.coupon.findMany({
      where: { id: { in: coupons.map((c) => c.couponId) } },
      select: { id: true, code: true, type: true },
    });
    const codeOf = new Map(couponRows.map((c) => [c.id, c.code]));

    return {
      summary: [
        [
          `MRR atual (R$)${lastSnapshot ? `, retrato de ${lastSnapshot.day}` : ', sem retrato'}`,
          money((lastSnapshot?.mrrCents ?? 0) / 100),
        ],
        ['Assinaturas pagantes (ativas + em atraso)', paying.length],
        ['Em teste agora', subs.filter((s) => s.status === 'TRIAL').length],
        ['Em atraso agora', subs.filter((s) => s.status === 'PAST_DUE').length],
        ['Assinaturas novas no período (planos pagos)', newInPeriod],
        ['Testes iniciados no período', act('TRIAL_STARTED')],
        ['Renovações e primeiras cobranças no período', act('RENEWED')],
        ['Cancelamentos pedidos no período', act('CANCELLED')],
        ['Encerradas por falta de pagamento ou fim do período', act('EXPIRED')],
        ['Cobranças recusadas no período', act('PAYMENT_FAILED')],
        ['Receita bruta aprovada (R$)', money(gross)],
        ['Taxa do Stripe (R$)', money(fees)],
        ['Reembolsos (R$)', money(refunds)],
        ['Contestações e tarifas (R$)', money(disputes)],
        ['Contestações ganhas devolvidas (R$)', money(won)],
        [
          'Receita líquida (R$)',
          money(gross - fees - refunds - disputes + won),
        ],
        [
          'Ticket médio por cobrança (R$)',
          approved.length ? money(gross / approved.length) : 0,
        ],
        ['Assinaturas com acesso hoje', live.length],
      ],
      sections: [
        {
          title: 'Assinaturas por plano e situação (hoje)',
          columns: ['Plano', 'Situação', 'Assinaturas'],
          rows: [...byPlanStatus.entries()]
            .map(([k, n]): Row => [...k.split('|'), n])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        },
        {
          title: 'Receita aprovada por plano e período de cobrança',
          columns: ['Plano', 'Cobrança', 'Cobranças', 'Receita (R$)'],
          rows: [...revenueByPlan.entries()].map(
            ([k, v]): Row => [...k.split('|'), v.n, money(v.total)],
          ),
        },
        {
          title: 'Movimento das assinaturas (histórico)',
          columns: ['Evento', 'Ocorrências'],
          rows: history
            .map((h): Row => [h.action, h._count._all])
            .sort((a, b) => Number(b[1]) - Number(a[1])),
        },
        {
          title: 'Receita aprovada por dia (R$)',
          columns: ['Dia', 'Cobranças', 'Receita (R$)'],
          rows: (() => {
            const map = new Map<string, { n: number; total: number }>();
            for (const p of approved) {
              const k = day(p.paidAt ?? p.createdAt);
              const cur = map.get(k) ?? { n: 0, total: 0 };
              cur.n++;
              cur.total += p.finalAmount;
              map.set(k, cur);
            }
            return [...map.entries()]
              .sort()
              .map(([k, v]): Row => [k, v.n, money(v.total)]);
          })(),
        },
        {
          title: 'MRR por dia (retrato diário)',
          columns: ['Dia', 'MRR (R$)', 'Ativas', 'Em teste', 'Em atraso'],
          rows: snapshots.map(
            (s): Row => [
              s.day,
              money(s.mrrCents / 100),
              s.active,
              s.trial,
              s.pastDue,
            ],
          ),
        },
        {
          title: 'Cupons usados no período',
          columns: ['Cupom', 'Usos', 'Desconto concedido (R$)'],
          rows: coupons
            .map(
              (c): Row => [
                codeOf.get(c.couponId) ?? c.couponId,
                c._count._all,
                money(c._sum.discountApplied),
              ],
            )
            .sort((a, b) => Number(b[1]) - Number(a[1])),
        },
        {
          title: 'Últimas cobranças recusadas (até 20)',
          columns: ['Data', 'Plano', 'Valor (R$)', 'E-mail'],
          rows: failures.map(
            (f): Row => [
              day(f.createdAt),
              PLAN_NAME[f.subscription?.planType ?? 'FREE'],
              money(f.finalAmount),
              f.payerEmail,
            ],
          ),
        },
      ],
    };
  }

  // ------------------------------------------------------------------
  async catalog(start: Date, end: Date): Promise<ReportData> {
    const period = { gte: start, lte: end };
    const q = await this.quality.get();
    const [
      composersByEpoch,
      composersByNationality,
      worksByType,
      scoresBySource,
      scoresTotal,
      scoresDownloaded,
      topDownloads,
      topImslp,
      newComposers,
      newWorks,
      newScores,
      noEdition,
    ] = await Promise.all([
      this.prisma.composer.groupBy({
        by: ['epochName'],
        _count: { _all: true },
        orderBy: { _count: { epochName: 'desc' } },
      }),
      this.prisma.composer.groupBy({
        by: ['nationality'],
        _count: { _all: true },
        orderBy: { _count: { nationality: 'desc' } },
        take: 30,
      }),
      this.prisma.work.groupBy({
        by: ['workType'],
        _count: { _all: true },
        orderBy: { _count: { workType: 'desc' } },
      }),
      this.prisma.workScore.groupBy({
        by: ['source'],
        _count: { _all: true },
      }),
      this.prisma.workScore.count(),
      this.prisma.workScore.count({ where: { siteDownloads: { gt: 0 } } }),
      this.prisma.workScore.findMany({
        where: { siteDownloads: { gt: 0 } },
        orderBy: { siteDownloads: 'desc' },
        take: 50,
        select: {
          title: true,
          siteDownloads: true,
          lastDownloadedAt: true,
          editor: true,
          publisher: true,
          work: {
            select: { title: true, composer: { select: { name: true } } },
          },
        },
      }),
      this.prisma.workScore.findMany({
        where: { downloadCount: { not: null } },
        orderBy: { downloadCount: 'desc' },
        take: 30,
        select: {
          title: true,
          downloadCount: true,
          work: {
            select: { title: true, composer: { select: { name: true } } },
          },
        },
      }),
      this.prisma.composer.count({
        where: { createdAt: period, isCustom: true },
      }),
      this.prisma.work.count({ where: { createdAt: period, isCustom: true } }),
      this.prisma.workScore.count({
        where: { createdAt: period, isCustom: true },
      }),
      this.prisma.workScore.count({
        where: {
          AND: [
            {
              OR: [
                { editor: null },
                { editor: '' },
                { editor: { isSet: false } },
              ],
            },
            {
              OR: [
                { publisher: null },
                { publisher: '' },
                { publisher: { isSet: false } },
              ],
            },
          ],
        },
      }),
    ]);

    const c = q.composers;
    const w = q.works;
    const fill = (name: string, has: number, total: number): Row => [
      name,
      has,
      total,
      total - has,
      pct(has, total),
    ];

    return {
      summary: [
        ['Compositores', c.total],
        ['Compositores verificados', c.verified],
        ['Obras', w.total],
        ['Partituras (arquivos)', scoresTotal],
        ['Partituras sem edição (editor e editora)', noEdition],
        ['Partituras já baixadas pelo site', scoresDownloaded],
        ['Biografias esperando revisão', c.bioWaitingReview],
        ['Compositores suspeitos de não serem compositores', c.suspects],
        [
          'Época que não confere com as datas',
          c.epochChecked - c.epochInAgreement,
        ],
        ['Compositores enviados pela comunidade no período', newComposers],
        ['Obras enviadas pela comunidade no período', newWorks],
        ['Partituras enviadas pela comunidade no período', newScores],
      ],
      sections: [
        {
          title: 'Preenchimento do cadastro',
          columns: ['Campo', 'Preenchidos', 'Total', 'Faltam', '% preenchido'],
          rows: [
            fill('Compositor: ano de nascimento', c.withBirthYear, c.total),
            fill('Compositor: nacionalidade', c.withNationality, c.total),
            fill('Compositor: biografia', c.withBio, c.total),
            fill('Compositor: retrato', c.withPortrait, c.total),
            fill('Compositor: com obras', c.withWorks, c.total),
            fill('Obra: tonalidade', w.withTone, w.total),
            fill('Obra: ano de composição', w.withYear, w.total),
            fill('Obra: instrumentação', w.withInstrumentation, w.total),
            fill('Obra: gravação ou vídeo', w.withMedia, w.total),
          ],
        },
        {
          title: 'Compositores por época',
          columns: ['Época', 'Compositores', '% do total'],
          rows: composersByEpoch.map(
            (e): Row => [
              e.epochName ?? 'Sem época',
              e._count._all,
              pct(e._count._all, c.total),
            ],
          ),
        },
        {
          title: 'Compositores por nacionalidade (30 maiores)',
          columns: ['Nacionalidade', 'Compositores'],
          rows: composersByNationality.map(
            (n): Row => [n.nationality ?? 'Sem nacionalidade', n._count._all],
          ),
        },
        {
          title: 'Obras por tipo',
          columns: ['Tipo', 'Obras'],
          rows: worksByType.map(
            (t): Row => [t.workType ?? 'Sem tipo', t._count._all],
          ),
        },
        {
          title: 'Partituras por fonte',
          columns: ['Fonte', 'Arquivos'],
          rows: scoresBySource.map((s): Row => [s.source, s._count._all]),
        },
        {
          title: 'Partituras mais baixadas pelo botão do site (50)',
          columns: [
            'Partitura',
            'Obra',
            'Compositor',
            'Downloads',
            'Último',
            'Editor',
            'Editora',
          ],
          rows: topDownloads.map(
            (s): Row => [
              s.title,
              s.work?.title ?? null,
              s.work?.composer?.name ?? null,
              s.siteDownloads,
              s.lastDownloadedAt ? day(s.lastDownloadedAt) : null,
              s.editor,
              s.publisher,
            ],
          ),
        },
        {
          title: 'Partituras mais baixadas no IMSLP (30), como referência',
          columns: ['Partitura', 'Obra', 'Compositor', 'Downloads no IMSLP'],
          rows: topImslp.map(
            (s): Row => [
              s.title,
              s.work?.title ?? null,
              s.work?.composer?.name ?? null,
              Number(s.downloadCount ?? 0),
            ],
          ),
        },
      ],
    };
  }

  // ------------------------------------------------------------------
  async teaching(start: Date, end: Date): Promise<ReportData> {
    const period = { gte: start, lte: end };
    const [teachers, links, lessons, assignments, pendingInvites] =
      await Promise.all([
        this.prisma.teacher.findMany({
          select: {
            id: true,
            status: true,
            createdAt: true,
            user: {
              select: { firstName: true, lastName: true, currentPlan: true },
            },
          },
        }),
        this.prisma.teacherStudent.findMany({
          select: { teacherId: true, isActive: true, inviteStatus: true },
        }),
        this.prisma.lesson.groupBy({
          by: ['status'],
          where: { scheduledAt: period },
          _count: { _all: true },
        }),
        this.prisma.assignment.groupBy({
          by: ['status'],
          where: { createdAt: period },
          _count: { _all: true },
        }),
        this.prisma.teacherStudent.count({
          where: { inviteStatus: 'PENDING' },
        }),
      ]);

    const active = new Map<string, number>();
    for (const l of links)
      if (l.isActive && l.inviteStatus === 'ACCEPTED')
        active.set(l.teacherId, (active.get(l.teacherId) ?? 0) + 1);
    const totalActive = [...active.values()].reduce((a, b) => a + b, 0);
    const lessonTotal = lessons.reduce((n, l) => n + l._count._all, 0);
    const done =
      lessons.find((l) => l.status === 'COMPLETED')?._count._all ?? 0;
    const noShow =
      lessons.find((l) => l.status === 'NO_SHOW')?._count._all ?? 0;
    const asTotal = assignments.reduce((n, a) => n + a._count._all, 0);
    const asDone =
      assignments.find((a) => a.status === 'COMPLETED')?._count._all ?? 0;
    const planOf = (t: (typeof teachers)[number]) =>
      (t.user.currentPlan ?? 'FREE') as PlanType;

    return {
      summary: [
        ['Professores cadastrados', teachers.length],
        ['Vínculos de aluno ativos e aceitos', totalActive],
        ['Convites pendentes', pendingInvites],
        ['Aulas no período', lessonTotal],
        ['Aulas concluídas', done],
        [
          'Taxa de comparecimento (concluídas ÷ concluídas + faltas) %',
          pct(done, done + noShow),
        ],
        ['Tarefas criadas no período', asTotal],
        ['Taxa de conclusão das tarefas %', pct(asDone, asTotal)],
        [
          'Professores acima do limite de alunos do plano',
          teachers.filter((t) => {
            const lim = PLAN_FEATURES[planOf(t)].maxStudents;
            return lim >= 0 && (active.get(t.id) ?? 0) > lim;
          }).length,
        ],
      ],
      sections: [
        {
          title: 'Professores por plano',
          columns: [
            'Plano',
            'Professores',
            'Alunos ativos',
            'Limite de alunos',
          ],
          rows: (['FREE', 'PLUS', 'MENTOR', 'MAESTRO'] as PlanType[]).map(
            (p): Row => {
              const mine = teachers.filter((t) => planOf(t) === p);
              const lim = PLAN_FEATURES[p].maxStudents;
              return [
                PLAN_NAME[p],
                mine.length,
                mine.reduce((n, t) => n + (active.get(t.id) ?? 0), 0),
                lim < 0 ? 'Ilimitado' : lim,
              ];
            },
          ),
        },
        {
          title: 'Professores com mais alunos ativos (20)',
          columns: ['Professor', 'Plano', 'Alunos ativos', 'Limite'],
          rows: [...teachers]
            .sort((a, b) => (active.get(b.id) ?? 0) - (active.get(a.id) ?? 0))
            .slice(0, 20)
            .map((t): Row => {
              const lim = PLAN_FEATURES[planOf(t)].maxStudents;
              return [
                `${t.user.firstName ?? ''} ${t.user.lastName ?? ''}`.trim(),
                PLAN_NAME[planOf(t)],
                active.get(t.id) ?? 0,
                lim < 0 ? 'Ilimitado' : lim,
              ];
            }),
        },
        {
          title: 'Aulas por situação (no período)',
          columns: ['Situação', 'Aulas'],
          rows: lessons.map((l): Row => [l.status, l._count._all]),
        },
        {
          title: 'Tarefas por situação (criadas no período)',
          columns: ['Situação', 'Tarefas'],
          rows: assignments.map((a): Row => [a.status, a._count._all]),
        },
        {
          title: 'Novos professores por dia',
          columns: ['Dia', 'Professores'],
          rows: dailySeries(
            teachers
              .filter((t) => t.createdAt >= start && t.createdAt <= end)
              .map((t) => t.createdAt),
            start,
            end,
          ),
        },
      ],
    };
  }

  // ------------------------------------------------------------------
  async learning(start: Date, end: Date): Promise<ReportData> {
    const period = { gte: start, lte: end };
    const [want, learned, achievements, contributions, topWant, topLearned] =
      await Promise.all([
        this.prisma.wantToLearn.findMany({
          select: { userId: true, addedAt: true },
        }),
        this.prisma.learned.findMany({
          select: {
            userId: true,
            learnedAt: true,
            mastery: true,
            videoUrl: true,
          },
        }),
        this.prisma.userAchievement.groupBy({
          by: ['name'],
          where: { unlockedAt: period },
          _count: { _all: true },
          orderBy: { _count: { name: 'desc' } },
          take: 20,
        }),
        this.prisma.contribution.groupBy({
          by: ['kind'],
          where: { createdAt: period },
          _count: { _all: true },
        }),
        this.prisma.wantToLearn.groupBy({
          by: ['workId'],
          _count: { _all: true },
          orderBy: { _count: { workId: 'desc' } },
          take: 20,
        }),
        this.prisma.learned.groupBy({
          by: ['workId'],
          _count: { _all: true },
          orderBy: { _count: { workId: 'desc' } },
          take: 20,
        }),
      ]);
    const ids = [...topWant, ...topLearned].map((x) => x.workId);
    const works = await this.prisma.work.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true, composer: { select: { name: true } } },
    });
    const label = new Map(
      works.map((w) => [w.id, `${w.title} — ${w.composer.name}`]),
    );
    const people = new Set([...want, ...learned].map((x) => x.userId));
    const avg = learned.length
      ? learned.reduce((n, l) => n + l.mastery, 0) / learned.length
      : 0;
    const wantNew = want.filter((x) => x.addedAt >= start && x.addedAt <= end);
    const learnedNew = learned.filter(
      (x) => x.learnedAt >= start && x.learnedAt <= end,
    );

    return {
      summary: [
        ['Itens em "quero aprender"', want.length],
        ['Itens em "já aprendi"', learned.length],
        ['Pessoas que usam as listas', people.size],
        ['Adicionados a "quero aprender" no período', wantNew.length],
        ['Marcados como "já aprendi" no período', learnedNew.length],
        ['Maestria média (0 a 100)', Math.round(avg * 10) / 10],
        [
          'Vídeos de performance em "já aprendi"',
          learned.filter((l) => l.videoUrl).length,
        ],
        [
          'Conquistas desbloqueadas no período',
          achievements.reduce((n, a) => n + a._count._all, 0),
        ],
      ],
      sections: [
        {
          title: '"Quero aprender" adicionados por dia',
          columns: ['Dia', 'Itens'],
          rows: dailySeries(
            wantNew.map((x) => x.addedAt),
            start,
            end,
          ),
        },
        {
          title: '"Já aprendi" por dia',
          columns: ['Dia', 'Itens'],
          rows: dailySeries(
            learnedNew.map((x) => x.learnedAt),
            start,
            end,
          ),
        },
        {
          title: 'Obras mais desejadas ("quero aprender")',
          columns: ['Obra', 'Pessoas'],
          rows: topWant.map(
            (x): Row => [label.get(x.workId) ?? x.workId, x._count._all],
          ),
        },
        {
          title: 'Obras mais aprendidas ("já aprendi")',
          columns: ['Obra', 'Pessoas'],
          rows: topLearned.map(
            (x): Row => [label.get(x.workId) ?? x.workId, x._count._all],
          ),
        },
        {
          title: 'Conquistas mais desbloqueadas no período',
          columns: ['Conquista', 'Desbloqueios'],
          rows: achievements.map((a): Row => [a.name, a._count._all]),
        },
        {
          title: 'Contribuições da comunidade no período',
          columns: ['Tipo', 'Contribuições'],
          rows: contributions.map((c): Row => [c.kind, c._count._all]),
        },
      ],
    };
  }

  // ------------------------------------------------------------------
  async newsletter(start: Date, end: Date): Promise<ReportData> {
    const period = { gte: start, lte: end };
    const [subscribers, campaigns, events] = await Promise.all([
      this.prisma.newsletterSubscriber.findMany({
        select: {
          status: true,
          language: true,
          subscribedAt: true,
          unsubscribedAt: true,
          referralSource: true,
        },
      }),
      this.prisma.newsletterCampaign.findMany({
        where: { sentAt: period },
        orderBy: { sentAt: 'desc' },
        select: {
          name: true,
          sentAt: true,
          totalSubscribers: true,
          emailsSent: true,
          emailsDelivered: true,
          emailsOpened: true,
          emailsClicked: true,
          emailsBounced: true,
          emailsUnsubscribed: true,
        },
      }),
      this.prisma.newsletterEmailEvent.groupBy({
        by: ['eventType'],
        where: { timestamp: period },
        _count: { _all: true },
      }),
    ]);
    const active = subscribers.filter((s) => s.status === 'ACTIVE');
    const joined = subscribers.filter(
      (s) => s.subscribedAt >= start && s.subscribedAt <= end,
    );
    const left = subscribers.filter(
      (s) =>
        s.unsubscribedAt &&
        s.unsubscribedAt >= start &&
        s.unsubscribedAt <= end,
    );
    const sent = campaigns.reduce((n, c) => n + c.emailsSent, 0);
    const opened = campaigns.reduce((n, c) => n + c.emailsOpened, 0);
    const clicked = campaigns.reduce((n, c) => n + c.emailsClicked, 0);

    return {
      summary: [
        ['Inscritos ativos', active.length],
        ['Novos inscritos no período', joined.length],
        ['Descadastros no período', left.length],
        ['Campanhas enviadas no período', campaigns.length],
        ['E-mails enviados nas campanhas', sent],
        ['Taxa de abertura %', pct(opened, sent)],
        ['Taxa de clique %', pct(clicked, sent)],
      ],
      sections: [
        {
          title: 'Inscritos por situação',
          columns: ['Situação', 'Inscritos'],
          rows: tally(subscribers, (s) => s.status).map(
            ([k, n]): Row => [k, n],
          ),
        },
        {
          title: 'Inscritos ativos por idioma',
          columns: ['Idioma', 'Inscritos'],
          rows: tally(active, (s) => s.language).map(([k, n]): Row => [k, n]),
        },
        {
          title: 'Origem dos novos inscritos',
          columns: ['Origem', 'Inscritos'],
          rows: tally(joined, (s) => s.referralSource).map(
            ([k, n]): Row => [k, n],
          ),
        },
        {
          title: 'Inscrições por dia',
          columns: ['Dia', 'Inscritos'],
          rows: dailySeries(
            joined.map((s) => s.subscribedAt),
            start,
            end,
          ),
        },
        {
          title: 'Campanhas enviadas no período',
          columns: [
            'Campanha',
            'Enviada em',
            'Enviados',
            'Entregues',
            'Abertos',
            'Cliques',
            'Devolvidos',
            'Descadastros',
            'Abertura %',
            'Clique %',
          ],
          rows: campaigns.map(
            (c): Row => [
              c.name,
              c.sentAt ? day(c.sentAt) : null,
              c.emailsSent,
              c.emailsDelivered,
              c.emailsOpened,
              c.emailsClicked,
              c.emailsBounced,
              c.emailsUnsubscribed,
              pct(c.emailsOpened, c.emailsSent),
              pct(c.emailsClicked, c.emailsSent),
            ],
          ),
        },
        {
          title: 'Eventos de e-mail no período',
          columns: ['Evento', 'Ocorrências'],
          rows: events.map((e): Row => [e.eventType, e._count._all]),
        },
      ],
    };
  }

  // ------------------------------------------------------------------
  async acquisition(start: Date, end: Date): Promise<ReportData> {
    const now = end.getTime();
    const [users, registered] = await Promise.all([
      this.prisma.user.findMany({
        select: {
          createdAt: true,
          lastSeen: true,
          userType: true,
          currentPlan: true,
          emailVerified: true,
          language: true,
          onboardingCompleted: true,
          isTeacher: true,
          isStudent: true,
        },
      }),
      this.prisma.user.count({
        where: { createdAt: { gte: start, lte: end } },
      }),
    ]);
    const seenSince = (days: number) =>
      users.filter(
        (u) => u.lastSeen && now - u.lastSeen.getTime() <= days * DAY_MS,
      ).length;
    const inPeriod = users.filter(
      (u) => u.createdAt >= start && u.createdAt <= end,
    );

    // Retenção aproximada: só há o último acesso, não as sessões. Por semana de
    // cadastro, quantos voltaram depois de 7 dias do cadastro.
    const cohorts = new Map<string, { n: number; back: number }>();
    for (const u of users.filter(
      (x) => x.createdAt >= new Date(now - 12 * 7 * DAY_MS),
    )) {
      const week = day(
        new Date(
          u.createdAt.getTime() - ((u.createdAt.getUTCDay() + 6) % 7) * DAY_MS,
        ),
      );
      const c = cohorts.get(week) ?? { n: 0, back: 0 };
      c.n++;
      if (
        u.lastSeen &&
        u.lastSeen.getTime() - u.createdAt.getTime() > 7 * DAY_MS
      )
        c.back++;
      cohorts.set(week, c);
    }

    return {
      summary: [
        ['Usuários', users.length],
        ['Cadastros no período', registered],
        ['Ativos nas últimas 24 horas', seenSince(1)],
        ['Ativos nos últimos 7 dias', seenSince(7)],
        ['Ativos nos últimos 30 dias', seenSince(30)],
        [
          'E-mail confirmado %',
          pct(users.filter((u) => u.emailVerified).length, users.length),
        ],
        [
          'Concluíram a apresentação %',
          pct(users.filter((u) => u.onboardingCompleted).length, users.length),
        ],
        [
          'Nunca voltaram depois do cadastro (aprox.)',
          users.filter(
            (u) =>
              !u.lastSeen ||
              u.lastSeen.getTime() - u.createdAt.getTime() < DAY_MS,
          ).length,
        ],
        ['Professores', users.filter((u) => u.isTeacher).length],
        ['Alunos vinculados', users.filter((u) => u.isStudent).length],
      ],
      sections: [
        {
          title: 'Cadastros por dia',
          columns: ['Dia', 'Cadastros'],
          rows: dailySeries(
            inPeriod.map((u) => u.createdAt),
            start,
            end,
          ),
        },
        {
          title: 'Usuários por plano',
          columns: ['Plano', 'Usuários', '%'],
          rows: tally(users, (u) => PLAN_NAME[u.currentPlan ?? 'FREE']).map(
            ([k, n]): Row => [k, n, pct(n, users.length)],
          ),
        },
        {
          title: 'Usuários por perfil',
          columns: ['Perfil', 'Usuários'],
          rows: tally(users, (u) => u.userType).map(([k, n]): Row => [k, n]),
        },
        {
          title: 'Usuários por idioma',
          columns: ['Idioma', 'Usuários'],
          rows: tally(users, (u) => u.language).map(([k, n]): Row => [k, n]),
        },
        {
          title: 'Retenção aproximada por semana de cadastro (12 semanas)',
          columns: [
            'Semana (segunda)',
            'Cadastros',
            'Voltaram depois de 7 dias',
            '% que voltou',
          ],
          rows: [...cohorts.entries()]
            .sort()
            .map(([k, v]): Row => [k, v.n, v.back, pct(v.back, v.n)]),
        },
      ],
    };
  }
}
