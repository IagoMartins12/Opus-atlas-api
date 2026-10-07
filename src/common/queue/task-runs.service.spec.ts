import { TaskRunsService } from './task-runs.service';

describe('TaskRunsService', () => {
  const prisma = {
    taskRun: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn().mockResolvedValue({ count: 4 }),
      aggregateRaw: jest.fn().mockResolvedValue([]),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new TaskRunsService(prisma as never);
  const tarefa = {
    queue: 'maintenance',
    task: 'tokens.prune',
    taskName: 'Tokens',
  };
  const job = (over: Record<string, unknown> = {}) =>
    ({
      id: 'j1',
      attemptsMade: 0,
      data: { requestedBy: 'admin-1', payload: {} },
      ...over,
    }) as never;

  beforeEach(() => jest.clearAllMocks());

  it('grava a execução manual com quem pediu e o resumo', async () => {
    const r = await service.rastrear(
      job(),
      {
        ...tarefa,
        relato: (x: { n: number }) => ({ summary: { removidos: x.n } }),
      },
      () => Promise.resolve({ n: 3 }),
    );

    expect(r).toEqual({ n: 3 });
    expect(prisma.taskRun.create.mock.calls[0][0].data).toMatchObject({
      task: 'tokens.prune',
      trigger: 'manual',
      requestedBy: 'admin-1',
      status: 'ok',
      attempt: 1,
      summary: { removidos: 3 },
    });
  });

  // O `requestedBy` de um agendado é quem criou o agendamento, não quem rodou.
  it('agendado: quem rodou foi o sistema', async () => {
    await service.rastrear(
      job({ id: 'repeat:maintenance:tokens.prune:1', repeatJobKey: 'k' }),
      tarefa,
      () => Promise.resolve({}),
    );

    expect(prisma.taskRun.create.mock.calls[0][0].data).toMatchObject({
      trigger: 'agendado',
      requestedBy: null,
    });
  });

  it('varredura sem efeito não é gravada; falha sempre é, e o erro segue', async () => {
    await service.rastrear(job(), { ...tarefa, gravar: () => false }, () =>
      Promise.resolve({}),
    );
    expect(prisma.taskRun.create).not.toHaveBeenCalled();

    await expect(
      service.rastrear(job(), { ...tarefa, gravar: () => false }, () =>
        Promise.reject(new Error('banco fora')),
      ),
    ).rejects.toThrow('banco fora');
    expect(prisma.taskRun.create.mock.calls[0][0].data).toMatchObject({
      status: 'falhou',
      error: 'banco fora',
    });
  });

  it('falhar ao gravar não derruba a tarefa', async () => {
    prisma.taskRun.create.mockRejectedValueOnce(new Error('mongo'));

    await expect(
      service.rastrear(job(), tarefa, () => Promise.resolve('feito')),
    ).resolves.toBe('feito');
  });

  it('apaga os escolhidos ou os anteriores a uma data; sem critério, nada', async () => {
    await expect(service.apagar({})).resolves.toEqual({ apagados: 0 });
    expect(prisma.taskRun.deleteMany).not.toHaveBeenCalled();

    await service.apagar({ ids: ['a'] });
    expect(prisma.taskRun.deleteMany).toHaveBeenLastCalledWith({
      where: { id: { in: ['a'] } },
    });

    await service.apagar({ before: '2026-09-01T00:00:00.000Z', task: 'x' });
    expect(prisma.taskRun.deleteMany).toHaveBeenLastCalledWith({
      where: {
        startedAt: { lt: new Date('2026-09-01T00:00:00.000Z') },
        task: 'x',
      },
    });
  });

  it('lista com o nome de quem disparou', async () => {
    prisma.taskRun.findMany.mockResolvedValueOnce([
      { id: 'r1', requestedBy: 'u1' },
      { id: 'r2', requestedBy: null },
    ]);
    prisma.user.findMany.mockResolvedValueOnce([
      { id: 'u1', firstName: 'Ana', lastName: 'Lima' },
    ]);

    const r = await service.listar({ trigger: 'manual' });

    expect(r.items.map((i) => i.requestedByName)).toEqual(['Ana Lima', null]);
    expect(prisma.taskRun.findMany.mock.calls[0][0].where).toEqual({
      trigger: 'manual',
    });
  });
});
