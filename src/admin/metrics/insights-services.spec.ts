import { PrismaService } from '../../prisma/prisma.service';
import { AudienceInsightsService } from './audience-insights.service';
import { CatalogInsightsService } from './catalog-insights.service';
import { LearningInsightsService } from './learning-insights.service';
import { MonetizationInsightsService } from './monetization-insights.service';
import { TeachingInsightsService } from './teaching-insights.service';

const DAY = 24 * 60 * 60 * 1000;

/** Um mock de Prisma em que cada `model.method` é um `jest.fn`, criado sob demanda. */
function prismaMock(aggregates: Record<string, unknown[]> = {}) {
  const models: Record<string, Record<string, jest.Mock>> = {};
  const $runCommandRaw = jest.fn(({ aggregate }: { aggregate: string }) =>
    Promise.resolve({ cursor: { firstBatch: aggregates[aggregate] ?? [] } }),
  );
  return new Proxy({ $runCommandRaw } as Record<string, unknown>, {
    get(target, model: string) {
      if (model in target) return target[model];
      models[model] ??= new Proxy({} as Record<string, jest.Mock>, {
        get(methods, method: string) {
          methods[method] ??= jest
            .fn()
            .mockResolvedValue(method === 'count' ? 0 : []);
          return methods[method];
        },
      });
      return models[model];
    },
  }) as unknown as Record<string, Record<string, jest.Mock>> & {
    $runCommandRaw: jest.Mock;
  };
}

const byCode = (insights: Array<{ code: string }>, code: string) =>
  insights.find((insight) => insight.code === code) as unknown as {
    severity: string;
    measurement: { value: number | null; sampleSize: number };
    evidence: unknown[];
    detail: string;
    action: string | null;
  };

describe('AudienceInsightsService', () => {
  it('sem cadastros recentes nem usuários: tudo sem base', async () => {
    const prisma = prismaMock();
    const insights = await new AudienceInsightsService(
      prisma as unknown as PrismaService,
    ).collect();

    expect(insights.map((i) => i.code)).toEqual([
      'audience.activation',
      'audience.dormant',
      'audience.onboarding_dropoff',
      'audience.retention_cohorts',
    ]);
    // Sem amostra, o insight se declara sem base em vez de afirmar.
    expect(byCode(insights, 'audience.activation').severity).toBe(
      'insufficient_data',
    );
    expect(
      byCode(insights, 'audience.activation').measurement.value,
    ).toBeNull();
  });

  it('ativação: conta a primeira ação de valor em até sete dias', async () => {
    const prisma = prismaMock();
    const now = Date.now();
    const users = Array.from({ length: 10 }, (_, i) => ({
      id: `u${i}`,
      createdAt: new Date(now - 30 * DAY),
    }));
    prisma.user.findMany.mockResolvedValue(users);
    prisma.favoriteWork.findMany.mockResolvedValue([
      { userId: 'u0', createdAt: new Date(now - 29 * DAY) },
    ]);
    prisma.wantToLearn.findMany.mockResolvedValue([
      { userId: 'u1', addedAt: new Date(now - 28 * DAY) },
      { userId: 'u0', addedAt: new Date(now - 29.5 * DAY) },
    ]);
    prisma.learned.findMany.mockResolvedValue([
      { userId: 'u2', learnedAt: null },
    ]);
    // Ação depois de sete dias não conta como ativação.
    prisma.workAnnotation.findMany.mockResolvedValue([
      { userId: 'u3', createdAt: new Date(now - 5 * DAY) },
    ]);
    prisma.user.count.mockResolvedValue(10);

    const insights = await new AudienceInsightsService(
      prisma as unknown as PrismaService,
    ).collect();
    const activation = byCode(insights, 'audience.activation');

    expect(activation.measurement).toMatchObject({ value: 20, sampleSize: 10 });
    expect(activation.severity).toBe('warning');
    expect(activation.action).toContain('primeiro passo');
  });

  it('dormentes separam quem nunca voltou de quem sumiu; coortes mostram a tendência', async () => {
    const prisma = prismaMock({
      User: [
        { _id: '2026-04', total: 10, retornaram: 2 },
        { _id: '2026-08', total: 10, retornaram: 6 },
      ],
    });
    prisma.user.count.mockImplementation(({ where } = {}) =>
      Promise.resolve(
        where?.lastSeen?.not === null
          ? 70
          : where?.lastSeen
            ? 20
            : where?.onboardingCompleted
              ? 30
              : 100,
      ),
    );

    const insights = await new AudienceInsightsService(
      prisma as unknown as PrismaService,
    ).collect();

    expect(byCode(insights, 'audience.dormant').evidence).toEqual([
      { nuncaVoltaram: 30, sumiram: 20, total: 100 },
    ]);
    expect(
      byCode(insights, 'audience.onboarding_dropoff').measurement.value,
    ).toBe(70);
    const cohorts = byCode(insights, 'audience.retention_cohorts');
    expect(cohorts.measurement.value).toBe(40);
    expect(cohorts.detail).toContain('subiu 40 ponto(s)');
  });
});

describe('MonetizationInsightsService', () => {
  it('sem assinaturas: teto do plano sem base', async () => {
    const prisma = prismaMock();
    const insights = await new MonetizationInsightsService(
      prisma as unknown as PrismaService,
    ).collect();

    expect(byCode(insights, 'monetization.at_plan_limit').severity).toBe(
      'insufficient_data',
    );
  });

  it('distribuição, conversão, teto do plano e testes acabando', async () => {
    const prisma = prismaMock();
    prisma.subscription.groupBy.mockResolvedValue([
      { planType: 'FREE', _count: { _all: 8 } },
      { planType: 'PLUS', _count: { _all: 2 } },
    ]);
    prisma.user.count.mockResolvedValue(20);
    prisma.subscription.count.mockImplementation(({ where }) =>
      Promise.resolve(
        where.status === 'TRIAL' ? 4 : where.status === 'ACTIVE' ? 3 : 7,
      ),
    );
    prisma.subscription.findMany.mockImplementation(({ where }) =>
      Promise.resolve(
        where.trialEndDate
          ? [{ userId: 'u9', planType: 'PLUS', trialEndDate: new Date() }]
          : [
              { userId: 'u1', planType: 'FREE' },
              { userId: 'u2', planType: 'PLUS' },
            ],
      ),
    );
    prisma.storedAsset.groupBy.mockResolvedValue([
      { ownerId: 'u1', _count: { _all: 99 } },
      { ownerId: null, _count: { _all: 1 } },
    ]);
    prisma.teacher.findMany.mockResolvedValue([
      { userId: 'u2', _count: { students: 0 } },
    ]);

    const insights = await new MonetizationInsightsService(
      prisma as unknown as PrismaService,
    ).collect();

    expect(byCode(insights, 'monetization.plan_distribution').detail).toContain(
      '2 assinatura(s) paga(s) entre 20',
    );
    expect(
      byCode(insights, 'monetization.trial_conversion').measurement.value,
    ).toBe(30);
    const atLimit = byCode(insights, 'monetization.at_plan_limit');
    expect(atLimit.evidence).toEqual([
      {
        userId: 'u1',
        plano: 'FREE',
        motivos: [expect.stringContaining('envios')],
      },
    ]);
    expect(
      byCode(insights, 'monetization.expiring_trials').measurement.value,
    ).toBe(1);
  });
});

describe('CatalogInsightsService', () => {
  it('sem dados de preferência nem demanda', async () => {
    const prisma = prismaMock();
    const insights = await new CatalogInsightsService(
      prisma as unknown as PrismaService,
    ).collect();

    expect(byCode(insights, 'catalog.popular_unverified').severity).toBe(
      'insufficient_data',
    );
    expect(
      byCode(insights, 'catalog.demand_without_supply').measurement.sampleSize,
    ).toBe(0);
  });

  it('demanda sem oferta, procurados sem verificação, obras sem partitura e cobertura', async () => {
    const prisma = prismaMock({
      WantToLearn: [
        { _id: { $oid: 'w1' }, demanda: 12, partituras: [] },
        { _id: { $oid: 'w-sumiu' }, demanda: 3, partituras: [] },
      ],
      FavoriteComposer: [
        { _id: { $oid: 'c1' }, demanda: 9 },
        { _id: { $oid: 'c2' }, demanda: 20 },
      ],
      work_scores: [{ n: 40 }],
    });
    prisma.wantToLearn.count.mockResolvedValue(30);
    prisma.work.findMany.mockResolvedValue([
      { id: 'w1', title: 'Noturno', composer: { name: 'Chopin' } },
    ]);
    prisma.composer.findMany.mockResolvedValue([
      { id: 'c1', name: 'Bach' },
      { id: 'c2', name: 'Albéniz' },
    ]);
    prisma.work.count.mockImplementation(({ where } = {}) =>
      Promise.resolve(where?.isVerified ? 10 : 100),
    );
    prisma.composer.count.mockImplementation(({ where } = {}) =>
      Promise.resolve(where?.isVerified ? 5 : 50),
    );

    const insights = await new CatalogInsightsService(
      prisma as unknown as PrismaService,
    ).collect();

    const gap = byCode(insights, 'catalog.demand_without_supply');
    expect(gap.evidence).toEqual([
      { id: 'w1', title: 'Noturno', composer: 'Chopin', alunosEsperando: 12 },
      { id: 'w-sumiu', title: null, composer: null, alunosEsperando: 3 },
    ]);
    expect(byCode(insights, 'catalog.popular_unverified').evidence).toEqual([
      { id: 'c2', name: 'Albéniz', favoritos: 20 },
      { id: 'c1', name: 'Bach', favoritos: 9 },
    ]);
    expect(
      byCode(insights, 'catalog.works_without_score').measurement.value,
    ).toBe(60);
    expect(
      byCode(insights, 'catalog.verification_coverage').measurement.value,
    ).toBe(10);
  });
});

describe('LearningInsightsService', () => {
  it('sem conclusões: domínio sem base', async () => {
    const prisma = prismaMock();
    prisma.learned.groupBy.mockResolvedValue([]);
    prisma.wantToLearn.groupBy.mockResolvedValue([]);

    const insights = await new LearningInsightsService(
      prisma as unknown as PrismaService,
    ).collect();

    expect(byCode(insights, 'learning.mastery_distribution').severity).toBe(
      'insufficient_data',
    );
  });

  it('funil, intenções paradas, faixas de domínio e concentração', async () => {
    const prisma = prismaMock();
    prisma.wantToLearn.count.mockImplementation(({ where } = {}) =>
      Promise.resolve(where?.addedAt ? 30 : 40),
    );
    prisma.learned.count.mockResolvedValue(20);
    prisma.wantToLearn.groupBy.mockResolvedValue([
      { workId: 'w1', _count: { _all: 6 } },
    ]);
    prisma.work.findMany.mockResolvedValue([
      { id: 'w1', title: 'Fantasia', composer: { name: 'Chopin' } },
    ]);
    prisma.learned.findMany.mockResolvedValue(
      [
        10, 20, 30, 50, 60, 80, 90, 95, 99, 100, 10, 20, 30, 50, 60, 80, 90, 95,
        99, 100,
      ].map((mastery) => ({ mastery })),
    );
    prisma.learned.groupBy.mockResolvedValue([
      { workId: 'w1', _count: { _all: 6 } },
      { workId: 'w2', _count: { _all: 2 } },
    ]);
    prisma.work.count.mockResolvedValue(1000);

    const insights = await new LearningInsightsService(
      prisma as unknown as PrismaService,
    ).collect();

    expect(
      byCode(insights, 'learning.intent_conversion').measurement.value,
    ).toBe(33.3);
    const stalled = byCode(insights, 'learning.stalled_intents');
    expect(stalled.measurement.value).toBe(75);
    expect(stalled.severity).toBe('warning');
    expect(stalled.evidence).toEqual([
      { workId: 'w1', title: 'Fantasia', composer: 'Chopin', alunosParados: 6 },
    ]);
    expect(byCode(insights, 'learning.mastery_distribution').evidence).toEqual([
      { baixo: 6, medio: 4, alto: 10 },
    ]);
    expect(
      byCode(insights, 'learning.repertoire_breadth').measurement.value,
    ).toBe(40);
  });
});

describe('TeachingInsightsService', () => {
  it('sem vínculos ativos', async () => {
    const prisma = prismaMock();
    const insights = await new TeachingInsightsService(
      prisma as unknown as PrismaService,
    ).collect();

    expect(
      byCode(insights, 'teaching.students_without_upcoming_lesson').severity,
    ).toBe('insufficient_data');
  });

  it('alunos sem aula, tarefas sem resposta, aulas sem fechar e presença', async () => {
    const prisma = prismaMock();
    const person = (firstName: string) => ({
      user: { firstName, lastName: null },
    });
    prisma.teacherStudent.findMany.mockResolvedValue([
      {
        studentId: 's1',
        teacherId: 't1',
        startDate: new Date(),
        student: { id: 's1', ...person('Ana') },
        teacher: { id: 't1', ...person('Beto') },
      },
      {
        studentId: 's2',
        teacherId: 't1',
        startDate: new Date(),
        student: { id: 's2', ...person('Caio') },
        teacher: { id: 't1', ...person('Beto') },
      },
      {
        studentId: 's3',
        teacherId: 't1',
        startDate: new Date(),
        student: { id: 's3', ...person('Dora') },
        teacher: { id: 't1', ...person('Beto') },
      },
    ]);
    prisma.lesson.findMany.mockImplementation(({ where }) =>
      Promise.resolve(
        where.studentId
          ? [{ studentId: 's1', teacherId: 't1' }]
          : [
              {
                id: 'l1',
                title: 'Aula',
                scheduledAt: new Date(),
                teacher: person('Beto'),
              },
            ],
      ),
    );
    prisma.assignment.count.mockImplementation(({ where }) =>
      Promise.resolve(where.teacherFeedback === null ? 2 : 4),
    );
    prisma.assignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        title: 'Escalas',
        completedAt: new Date(Date.now() - 10 * DAY),
        student: person('Ana'),
        lesson: { teacher: person('Beto') },
      },
      {
        id: 'a2',
        title: 'Arpejos',
        completedAt: null,
        student: person('Caio'),
        lesson: { teacher: person('Beto') },
      },
    ]);
    prisma.lesson.count.mockImplementation(({ where }) =>
      Promise.resolve(
        where.status === 'COMPLETED'
          ? 9
          : where.status === 'NO_SHOW'
            ? 1
            : where.status === 'SCHEDULED'
              ? 3
              : 10,
      ),
    );

    const insights = await new TeachingInsightsService(
      prisma as unknown as PrismaService,
    ).collect();

    const orphans = byCode(
      insights,
      'teaching.students_without_upcoming_lesson',
    );
    expect(orphans.evidence).toEqual([
      expect.objectContaining({ aluno: 'Caio', professor: 'Beto' }),
      expect.objectContaining({ aluno: 'Dora', professor: 'Beto' }),
    ]);
    expect(orphans.severity).toBe('critical');
    const feedback = byCode(insights, 'teaching.assignments_awaiting_feedback');
    expect(feedback.evidence).toEqual([
      expect.objectContaining({ tarefa: 'Escalas', diasEsperando: 10 }),
      expect.objectContaining({ tarefa: 'Arpejos', diasEsperando: null }),
    ]);
    expect(
      byCode(insights, 'teaching.lessons_pending_closure').measurement.value,
    ).toBe(30);
    expect(
      byCode(insights, 'teaching.attendance_health').measurement.value,
    ).toBe(90);
  });
});
