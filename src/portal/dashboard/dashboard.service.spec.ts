import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LessonStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardService } from './dashboard.service';

const at = (iso: string) => new Date(iso);

const person = (id: string, first: string, last: string) => ({
  id,
  userId: `${id}-user`,
  user: { firstName: first, lastName: last, image: null },
});

describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: {
    teacher: { findUnique: jest.Mock };
    student: { findUnique: jest.Mock };
    teacherStudent: { count: jest.Mock; findMany: jest.Mock };
    lesson: {
      groupBy: jest.Mock;
      count: jest.Mock;
      aggregate: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
    };
    assignment: { count: jest.Mock; findMany: jest.Mock };
    wantToLearn: { findMany: jest.Mock };
    learned: { findMany: jest.Mock };
    workAnnotation: { findMany: jest.Mock };
  };

  const statusRow = (status: LessonStatus, n: number) => ({
    status,
    _count: { _all: n },
  });

  /**
   * O painel dispara várias buscas de aula na mesma transação lógica. Um
   * `mockResolvedValue` único responderia a todas com a mesma linha, o que
   * quebraria a projeção que espera a relação carregada. O despacho abaixo
   * responde cada consulta pelo `select` que ela pediu.
   */
  type LessonFindManyStubs = {
    upcoming?: unknown[];
    weekly?: unknown[];
    /** Varredura de agenda por aluno (painel do professor). */
    schedule?: unknown[];
    /** Próximas aulas por professor (painel do aluno). */
    byTeacher?: unknown[];
  };

  const stubLessonFindMany = (stubs: LessonFindManyStubs) => {
    prisma.lesson.findMany.mockImplementation(
      (args: { select?: Record<string, unknown> }) => {
        const select = args.select ?? {};

        if ('objectives' in select) {
          return Promise.resolve(stubs.upcoming ?? []);
        }

        if ('title' in select) {
          return Promise.resolve(stubs.weekly ?? []);
        }

        if ('studentId' in select) {
          return Promise.resolve(stubs.schedule ?? []);
        }

        if ('teacherId' in select) {
          return Promise.resolve(stubs.byTeacher ?? []);
        }

        return Promise.resolve([]);
      },
    );
  };

  /**
   * O retorno é um union discriminado por `role`. Estreitar aqui deixa cada
   * teste falando só do painel que lhe interessa.
   */
  const studentDashboard = async () => {
    const result = await service.getDashboard('user-1', { as: 'student' });

    if (result.role !== 'student') {
      throw new Error('esperava o painel do aluno');
    }

    return result;
  };

  const teacherDashboard = async () => {
    const result = await service.getDashboard('user-1', { as: 'teacher' });

    if (result.role !== 'teacher') {
      throw new Error('esperava o painel do professor');
    }

    return result;
  };

  beforeEach(async () => {
    prisma = {
      teacher: { findUnique: jest.fn().mockResolvedValue({ id: 'teacher-1' }) },
      student: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'student-1',
          currentStreak: 3,
          longestStreak: 7,
          totalLessonsAttended: 12,
          level: 'INTERMEDIATE',
          mainInstrument: 'Piano',
        }),
      },
      teacherStudent: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      lesson: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { duration: null } }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      assignment: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      wantToLearn: { findMany: jest.fn().mockResolvedValue([]) },
      learned: { findMany: jest.fn().mockResolvedValue([]) },
      workAnnotation: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(DashboardService);
  });

  // -----------------------------------------------------------------
  describe('escolha do painel', () => {
    it('usa o professor quando há perfil', async () => {
      const result = await service.getDashboard('user-1', {});

      expect(result.role).toBe('teacher');
    });

    it('usa o aluno quando pedido', async () => {
      const result = await service.getDashboard('user-1', { as: 'student' });

      expect(result.role).toBe('student');
    });

    it('cai para aluno quando não há perfil de professor', async () => {
      prisma.teacher.findUnique.mockResolvedValue(null);

      const result = await service.getDashboard('user-1', {});

      expect(result.role).toBe('student');
    });

    it('recusa `as=teacher` sem perfil de professor', async () => {
      prisma.teacher.findUnique.mockResolvedValue(null);

      await expect(
        service.getDashboard('user-1', { as: 'teacher' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('recusa quem não tem perfil nenhum', async () => {
      prisma.teacher.findUnique.mockResolvedValue(null);
      prisma.student.findUnique.mockResolvedValue(null);

      await expect(service.getDashboard('user-1', {})).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // -----------------------------------------------------------------
  describe('painel do aluno', () => {
    const student = studentDashboard;

    it('soma o tempo de estudo no banco, não em memória', async () => {
      prisma.lesson.aggregate.mockResolvedValue({ _sum: { duration: 540 } });

      const result = await student();

      expect(result.stats.studyMinutes).toBe(540);
      expect(prisma.lesson.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ _sum: { duration: true } }),
      );
    });

    // O legado dividia pelo total de aulas, futuras incluídas.
    it('a presença considera só aula que já aconteceu', async () => {
      prisma.lesson.groupBy.mockResolvedValue([
        statusRow(LessonStatus.COMPLETED, 3),
        statusRow(LessonStatus.NO_SHOW, 1),
        statusRow(LessonStatus.SCHEDULED, 20),
      ]);

      const result = await student();

      expect(result.stats.attendanceRate).toBe(75);
    });

    it('a presença é nula quando nada aconteceu', async () => {
      prisma.lesson.groupBy.mockResolvedValue([
        statusRow(LessonStatus.SCHEDULED, 5),
      ]);

      const result = await student();

      expect(result.stats.attendanceRate).toBeNull();
    });

    it('traz a sequência do perfil', async () => {
      const result = await student();

      expect(result.stats.currentStreak).toBe(3);
      expect(result.stats.longestStreak).toBe(7);
    });

    // O legado filtrava `isPublic: true` nas anotações do próprio usuário, no
    // painel dele: quem anotava em particular via a seção sempre vazia.
    it('mostra as próprias anotações, públicas ou não', async () => {
      await student();

      const call = prisma.workAnnotation.findMany.mock.calls[0][0];

      expect(call.where).toEqual({ userId: 'user-1' });
      expect(call.where).not.toHaveProperty('isPublic');
    });

    it('separa as aulas de hoje das próximas', async () => {
      // **O relógio é fixado de propósito.** Este teste montava a aula como
      // "agora + 1 hora" e, rodando depois das 23h, a aula caía no dia
      // seguinte: `todayLessons` vinha vazio e a suíte quebrava por hora do
      // dia, não por defeito. Só o `Date` é substituído; temporizadores
      // continuam reais, para não travar promessa nenhuma.
      jest.useFakeTimers({
        doNotFake: [
          'nextTick',
          'setImmediate',
          'setTimeout',
          'setInterval',
          'queueMicrotask',
        ],
      });
      jest.setSystemTime(new Date(2026, 4, 20, 9, 0, 0));

      const hoje = new Date();
      hoje.setHours(hoje.getHours() + 1);

      const amanha = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

      stubLessonFindMany({
        upcoming: [
          {
            id: 'l1',
            title: 'Hoje',
            scheduledAt: hoje,
            duration: 60,
            status: LessonStatus.SCHEDULED,
            location: null,
            objectives: [],
            homework: null,
            publicNotes: null,
            teacher: person('teacher-1', 'Ana', 'Costa'),
          },
          {
            id: 'l2',
            title: 'Depois',
            scheduledAt: amanha,
            duration: 60,
            status: LessonStatus.SCHEDULED,
            location: null,
            objectives: [],
            homework: null,
            publicNotes: null,
            teacher: person('teacher-1', 'Ana', 'Costa'),
          },
        ],
      });

      const result = await student();

      expect(result.upcomingLessons).toHaveLength(2);
      expect(result.todayLessons).toHaveLength(1);
      expect(result.todayLessons[0].title).toBe('Hoje');

      jest.useRealTimers();
    });

    it('mostra o professor como contraparte', async () => {
      stubLessonFindMany({
        upcoming: [
          {
            id: 'l1',
            title: 'Aula',
            scheduledAt: new Date(Date.now() + 3600_000),
            duration: 60,
            status: LessonStatus.SCHEDULED,
            location: null,
            objectives: [],
            homework: null,
            publicNotes: null,
            teacher: person('teacher-1', 'Ana', 'Costa'),
          },
        ],
      });

      const result = await student();

      expect(result.upcomingLessons[0].counterpart.name).toBe('Ana Costa');
    });
  });

  // -----------------------------------------------------------------
  describe('professores do aluno', () => {
    beforeEach(() => {
      prisma.teacherStudent.findMany.mockResolvedValue([
        {
          startDate: at('2026-01-10T00:00:00.000Z'),
          totalLessons: 4,
          teacher: {
            ...person('teacher-1', 'Ana', 'Costa'),
            specialties: ['Piano'],
            instruments: ['Piano'],
          },
        },
        {
          startDate: at('2026-02-10T00:00:00.000Z'),
          totalLessons: 2,
          teacher: {
            ...person('teacher-2', 'Bruno', 'Lima'),
            specialties: [],
            instruments: ['Violão'],
          },
        },
      ]);
    });

    // O legado fazia duas consultas por professor dentro de um `map`.
    it('resolve próxima aula e total sem consulta por professor', async () => {
      stubLessonFindMany({
        byTeacher: [
          {
            teacherId: 'teacher-1',
            scheduledAt: at('2026-10-01T19:00:00.000Z'),
          },
          {
            teacherId: 'teacher-1',
            scheduledAt: at('2026-10-08T19:00:00.000Z'),
          },
          {
            teacherId: 'teacher-2',
            scheduledAt: at('2026-10-02T19:00:00.000Z'),
          },
        ],
      });
      prisma.lesson.groupBy.mockResolvedValue([
        { teacherId: 'teacher-1', _count: { _all: 9 } },
        { teacherId: 'teacher-2', _count: { _all: 4 } },
      ]);

      const result = await studentDashboard();
      const [ana, bruno] = result.teachers;

      expect(ana?.nextLessonAt).toEqual(at('2026-10-01T19:00:00.000Z'));
      expect(ana?.totalLessons).toBe(9);
      expect(bruno?.nextLessonAt).toEqual(at('2026-10-02T19:00:00.000Z'));
      expect(bruno?.totalLessons).toBe(4);
    });

    it('professor sem aula marcada vem com próxima nula', async () => {
      stubLessonFindMany({});
      prisma.lesson.groupBy.mockResolvedValue([]);

      const result = await studentDashboard();

      expect(result.teachers[0].nextLessonAt).toBeNull();
      expect(result.teachers[0].totalLessons).toBe(0);
    });
  });

  // -----------------------------------------------------------------
  describe('painel do professor', () => {
    const teacher = teacherDashboard;

    // `teacherProfile.id.length` é 24 — o comprimento da string do id. O
    // denominador virava "semanas desde 1970" e a média saía sempre 0.
    it('a média semanal usa a primeira aula, não o comprimento do id', async () => {
      const dezSemanasAtras = new Date(
        Date.now() - 10 * 7 * 24 * 60 * 60 * 1000,
      );

      prisma.lesson.groupBy.mockResolvedValue([
        statusRow(LessonStatus.COMPLETED, 20),
      ]);
      prisma.lesson.findFirst.mockResolvedValue({
        scheduledAt: dezSemanasAtras,
      });

      const result = await teacher();

      expect(result.stats.avgLessonsPerWeek).toBeCloseTo(2, 1);
      expect(result.stats.avgLessonsPerWeek).not.toBe(0);
    });

    it('a média é nula sem nenhuma aula', async () => {
      const result = await teacher();

      expect(result.stats.avgLessonsPerWeek).toBeNull();
    });

    // O legado dividia pelo total, punindo quem tinha muita aula à frente.
    it('a taxa de conclusão considera só aula que já passou', async () => {
      prisma.lesson.groupBy.mockResolvedValue([
        statusRow(LessonStatus.COMPLETED, 8),
        statusRow(LessonStatus.NO_SHOW, 2),
        statusRow(LessonStatus.SCHEDULED, 50),
      ]);
      // A primeira contagem do `Promise.all` é a de aulas já passadas.
      prisma.lesson.count.mockResolvedValueOnce(10);

      const result = await teacher();

      expect(result.stats.completionRate).toBe(80);
    });

    // `new Date(ano, mês + 1, 0)` é o último dia à meia-noite; com `lt`, o dia
    // do fechamento sumia da contagem todo mês.
    it('o mês vai até o primeiro instante do mês seguinte', async () => {
      await teacher();

      const chamadaDoMes = prisma.lesson.count.mock.calls.find(
        (call) => call[0]?.where?.scheduledAt?.gte?.getDate() === 1,
      );

      const fim = chamadaDoMes?.[0].where.scheduledAt.lt as Date;

      expect(fim.getDate()).toBe(1);
    });

    it('"aluno com atividade recente" exclui aula futura', async () => {
      await teacher();

      const chamada = prisma.teacherStudent.count.mock.calls.find(
        (call) => call[0]?.where?.student,
      );

      const janela = chamada?.[0].where.student.is.lessons.some.scheduledAt;

      expect(janela.gte).toBeInstanceOf(Date);
      expect(janela.lt).toBeInstanceOf(Date);
      expect(janela.lt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });
  });

  // -----------------------------------------------------------------
  describe('agenda da semana', () => {
    it('tem sete dias, mesmo vazios', async () => {
      const result = await teacherDashboard();

      expect(result.weeklySchedule).toHaveLength(7);
      expect(result.weeklySchedule[0].weekday).toBe(0);
    });

    // O legado devolvia `toLocaleTimeString('pt-BR')`, então o fuso e o idioma
    // do servidor entravam na resposta.
    it('devolve data, não hora formatada', async () => {
      const inicioDaSemana = new Date();
      inicioDaSemana.setDate(
        inicioDaSemana.getDate() - inicioDaSemana.getDay(),
      );
      inicioDaSemana.setHours(10, 30, 0, 0);

      prisma.lesson.findMany.mockImplementation(
        (args: { select?: Record<string, unknown> }) =>
          Promise.resolve(
            args.select && 'student' in args.select && 'title' in args.select
              ? [
                  {
                    id: 'l1',
                    title: 'Aula',
                    scheduledAt: inicioDaSemana,
                    duration: 60,
                    status: LessonStatus.SCHEDULED,
                    student: person('student-1', 'João', 'Silva'),
                  },
                ]
              : [],
          ),
      );

      const result = await teacherDashboard();

      const comAula = result.weeklySchedule.find(
        (dia) => dia.lessons.length > 0,
      );

      expect(comAula?.lessons[0].start).toBeInstanceOf(Date);
      expect(comAula?.lessons[0].end).toBeInstanceOf(Date);
      expect(typeof comAula?.lessons[0].start).not.toBe('string');
    });
  });

  // -----------------------------------------------------------------
  describe('alunos do professor', () => {
    beforeEach(() => {
      prisma.teacherStudent.findMany.mockResolvedValue([
        {
          startDate: at('2026-01-10T00:00:00.000Z'),
          totalLessons: 4,
          student: {
            ...person('student-1', 'João', 'Silva'),
            level: 'BEGINNER',
            mainInstrument: 'Piano',
          },
        },
      ]);
    });

    it('resolve última e próxima aula numa varredura só', async () => {
      const passado = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const futuro = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

      stubLessonFindMany({
        schedule: [
          {
            studentId: 'student-1',
            scheduledAt: passado,
            status: LessonStatus.COMPLETED,
          },
          {
            studentId: 'student-1',
            scheduledAt: futuro,
            status: LessonStatus.SCHEDULED,
          },
        ],
      });
      prisma.lesson.groupBy.mockResolvedValue([
        { studentId: 'student-1', _count: { _all: 6 } },
      ]);

      const result = await teacherDashboard();

      expect(result.students[0].lastLessonAt).toEqual(passado);
      expect(result.students[0].nextLessonAt).toEqual(futuro);
      expect(result.students[0].totalLessons).toBe(6);
    });

    it('aula futura cancelada não vira a próxima', async () => {
      stubLessonFindMany({
        schedule: [
          {
            studentId: 'student-1',
            scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
            status: LessonStatus.CANCELLED,
          },
        ],
      });
      prisma.lesson.groupBy.mockResolvedValue([]);

      const result = await teacherDashboard();

      expect(result.students[0].nextLessonAt).toBeNull();
    });
  });
});
