import { SubscriptionsService } from './subscriptions.service';

/**
 * O plano que vale: assinatura paga, ou o Plus dado pelo professor Maestro ao
 * aluno sem assinatura (decisão do dono, 21/10).
 */
describe('SubscriptionsService · plano efetivo', () => {
  const sub = (planType: string, userId = 'u') => ({
    id: `s-${userId}`,
    userId,
    planType,
    status: 'ACTIVE',
    endDate: null,
    trialEndDate: null,
  });

  function build(opts: {
    subs: Record<string, ReturnType<typeof sub> | null>;
    student?: { id: string } | null;
    teachers?: Array<{ userId: string; first: string }>;
    teacherProfile?: { id: string } | null;
    studentsOfTeacher?: string[];
  }) {
    const prisma = {
      subscription: {
        findFirst: jest.fn(({ where }: { where: { userId: string } }) =>
          Promise.resolve(opts.subs[where.userId] ?? null),
        ),
      },
      student: {
        findUnique: jest.fn().mockResolvedValue(opts.student ?? null),
      },
      teacherStudent: {
        findMany: jest.fn(({ select }: { select: Record<string, unknown> }) =>
          Promise.resolve(
            'teacher' in select
              ? (opts.teachers ?? []).map((t) => ({
                  teacher: {
                    userId: t.userId,
                    user: { firstName: t.first, lastName: 'Silva' },
                  },
                }))
              : (opts.studentsOfTeacher ?? []).map((id) => ({
                  student: { userId: id },
                })),
          ),
        ),
      },
      teacher: {
        findUnique: jest.fn().mockResolvedValue(opts.teacherProfile ?? null),
      },
      user: { update: jest.fn().mockResolvedValue({}) },
    };
    const service = new SubscriptionsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, prisma };
  }

  it('assinatura paga vale, mesmo sendo aluno de Maestro (quem paga segue pagando)', async () => {
    const { service } = build({
      subs: { aluno: sub('PLUS', 'aluno'), prof: sub('MAESTRO', 'prof') },
      student: { id: 'st' },
      teachers: [{ userId: 'prof', first: 'Ana' }],
    });
    const r = await service.effectivePlan('aluno');
    expect(r).toMatchObject({
      plan: 'PLUS',
      via: 'subscription',
      teacherName: null,
    });
  });

  it('aluno sem assinatura de professor Maestro ganha o Plus', async () => {
    const { service } = build({
      subs: { prof: sub('MAESTRO', 'prof') },
      student: { id: 'st' },
      teachers: [{ userId: 'prof', first: 'Ana' }],
    });
    const r = await service.effectivePlan('aluno');
    expect(r).toMatchObject({
      plan: 'PLUS',
      via: 'teacher',
      teacherName: 'Ana Silva',
    });
  });

  it('professor Mentor não dá o Plus', async () => {
    const { service } = build({
      subs: { prof: sub('MENTOR', 'prof') },
      student: { id: 'st' },
      teachers: [{ userId: 'prof', first: 'Ana' }],
    });
    expect((await service.effectivePlan('aluno')).plan).toBe('FREE');
  });

  it('sem vínculo, é Free', async () => {
    const { service } = build({ subs: {}, student: null });
    expect(await service.effectivePlan('x')).toMatchObject({
      plan: 'FREE',
      via: 'free',
    });
  });

  it('os limites seguem o plano efetivo', async () => {
    const { service } = build({
      subs: { prof: sub('MAESTRO', 'prof') },
      student: { id: 'st' },
      teachers: [{ userId: 'prof', first: 'Ana' }],
    });
    const access = await service.checkFeatureAccess('aluno', 'uploadLimit');
    expect(access).toMatchObject({ plan: 'PLUS', limit: -1 });
  });

  it('mudou o plano do professor: o cache dos alunos é refeito junto', async () => {
    const { service, prisma } = build({
      subs: { prof: sub('MENTOR', 'prof') },
      teacherProfile: { id: 't1' },
      studentsOfTeacher: ['a1', 'a2'],
    });
    await service.updateUserPlanCache('prof');
    const ids = prisma.user.update.mock.calls.map((c) => c[0].where.id);
    expect(ids).toEqual(['prof', 'a1', 'a2']);
  });

  it('grava o nome do professor no cache do aluno', async () => {
    const { service, prisma } = build({
      subs: { prof: sub('MAESTRO', 'prof') },
      student: { id: 'st' },
      teachers: [{ userId: 'prof', first: 'Ana' }],
    });
    await service.updateUserPlanCache('aluno');
    expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({
      currentPlan: 'PLUS',
      planViaTeacher: 'Ana Silva',
      planExpiresAt: null,
    });
  });
});
