import { AdminPortalService } from './admin-portal.service';

const user = (id: string, firstName: string) => ({
  id,
  firstName,
  lastName: null,
  username: null,
  email: `${id}@x`,
  image: null,
});

describe('AdminPortalService', () => {
  let prisma: Record<string, Record<string, jest.Mock>>;
  let service: AdminPortalService;

  beforeEach(() => {
    const modelo = () => ({
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      groupBy: jest.fn().mockResolvedValue([]),
    });
    prisma = {
      teacher: modelo(),
      student: modelo(),
      teacherStudent: modelo(),
      lesson: modelo(),
      assignment: modelo(),
    };
    service = new AdminPortalService(prisma as never);
  });

  it('presença só conta aula com desfecho; sem base, não inventa', async () => {
    let r = await service.overview(30);
    expect(r.aulas.presenca).toBeNull();

    prisma.lesson.groupBy.mockResolvedValueOnce([
      { status: 'COMPLETED', _count: { _all: 9 } },
      { status: 'NO_SHOW', _count: { _all: 1 } },
      { status: 'CANCELLED', _count: { _all: 5 } },
    ]);
    r = await service.overview(30);
    expect(r.aulas.presenca).toBe(90);
    expect(r.aulas.noPeriodo).toBe(15);
  });

  it('"sem desfecho" é aula que passou e continua agendada', async () => {
    await service.lessons({ quando: 'sem-desfecho' });

    const where = prisma.lesson.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toMatchObject({ status: 'SCHEDULED' });
    expect(where.AND[0].scheduledAt.lt).toBeInstanceOf(Date);
  });

  it('próximas vêm da mais perto; o resto, da mais recente', async () => {
    await service.lessons({ quando: 'proximas' });
    await service.lessons({ quando: 'passadas' });

    expect(prisma.lesson.findMany.mock.calls[0][0].orderBy).toEqual({
      scheduledAt: 'asc',
    });
    expect(prisma.lesson.findMany.mock.calls[1][0].orderBy).toEqual({
      scheduledAt: 'desc',
    });
  });

  it('aula vem com professor e aluno pelo nome', async () => {
    prisma.lesson.findMany.mockResolvedValueOnce([
      {
        id: 'l1',
        title: 'Escalas',
        scheduledAt: new Date(),
        duration: 60,
        status: 'SCHEDULED',
        type: 'INDIVIDUAL',
        teacher: { id: 't1', user: user('u1', 'Ana') },
        student: { id: 's1', user: user('u2', 'Bia') },
        _count: { assignments: 2 },
      },
    ]);

    const r = await service.lessons({});

    expect(r.items[0]).toMatchObject({
      titulo: 'Escalas',
      tarefas: 2,
      professor: { id: 't1', userId: 'u1', nome: 'Ana' },
      aluno: { id: 's1', userId: 'u2', nome: 'Bia' },
    });
  });

  it('tarefa atrasada: não concluída e com prazo vencido', async () => {
    await service.assignments({ situacao: 'atrasadas' });

    const where = prisma.assignment.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toMatchObject({ isCompleted: false });
    expect(where.AND[0].dueDate.lt).toBeInstanceOf(Date);
  });

  it('id inválido é 404, não erro do banco', async () => {
    await expect(service.lesson('x')).rejects.toThrow('Aula não encontrada');
    await expect(service.assignment('x')).rejects.toThrow(
      'Tarefa não encontrada',
    );
  });

  it('professores trazem alunos ativos e aulas', async () => {
    prisma.teacher.findMany.mockResolvedValueOnce([
      {
        id: 't1',
        status: 'ACTIVE',
        isVerified: true,
        instruments: [],
        createdAt: new Date(),
        user: user('u1', 'Ana'),
      },
    ]);
    prisma.teacherStudent.groupBy.mockResolvedValueOnce([
      { teacherId: 't1', _count: { _all: 4 } },
    ]);

    const r = await service.teachers({});

    expect(r.items[0]).toMatchObject({
      nome: 'Ana',
      alunosAtivos: 4,
      aulas30Dias: 0,
    });
  });
});
