import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LessonStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { CalendarService } from './calendar.service';

const at = (iso: string) => new Date(iso);

describe('CalendarService', () => {
  let service: CalendarService;
  let availability: { computeFreeTime: jest.Mock };
  let prisma: {
    teacher: { findUnique: jest.Mock };
    student: { findUnique: jest.Mock };
    lesson: { findMany: jest.Mock };
    assignment: { findMany: jest.Mock };
  };

  const lessonRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'lesson-1',
    title: 'Sonata',
    description: null,
    scheduledAt: at('2026-09-15T19:00:00.000Z'),
    duration: 60,
    status: LessonStatus.SCHEDULED,
    location: 'Online',
    objectives: [],
    topics: [],
    techniques: [],
    workScoreIds: [],
    homework: null,
    publicNotes: null,
    teacherNotes: 'anotação privada',
    lessonSummary: null,
    studentFeedback: null,
    isRecurring: false,
    teacher: {
      id: 'teacher-1',
      userId: 'teacher-user',
      user: { firstName: 'Ana', lastName: 'Costa', image: null },
    },
    student: {
      id: 'student-1',
      userId: 'student-user',
      level: 'INTERMEDIATE',
      user: { firstName: 'João', lastName: 'Silva', image: null },
    },
    ...overrides,
  });

  const assignmentRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'assignment-1',
    title: 'Estudar a exposição',
    description: 'Mãos separadas',
    type: 'practice',
    priority: 'medium',
    status: 'PENDING',
    dueDate: at('2026-09-20T23:59:00.000Z'),
    isCompleted: false,
    progress: 0,
    student: {
      id: 'student-1',
      userId: 'student-user',
      level: 'INTERMEDIATE',
      user: { firstName: 'João', lastName: 'Silva', image: null },
    },
    lesson: {
      id: 'lesson-1',
      teacher: {
        id: 'teacher-1',
        userId: 'teacher-user',
        user: { firstName: 'Ana', lastName: 'Costa', image: null },
      },
    },
    ...overrides,
  });

  const window = {
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-09-30T00:00:00.000Z',
  };

  beforeEach(async () => {
    prisma = {
      teacher: { findUnique: jest.fn().mockResolvedValue({ id: 'teacher-1' }) },
      student: { findUnique: jest.fn().mockResolvedValue({ id: 'student-1' }) },
      lesson: { findMany: jest.fn().mockResolvedValue([]) },
      assignment: { findMany: jest.fn().mockResolvedValue([]) },
    };

    availability = {
      computeFreeTime: jest.fn().mockResolvedValue({ slots: [], hours: null }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendarService,
        { provide: PrismaService, useValue: prisma },
        { provide: AvailabilityService, useValue: availability },
      ],
    }).compile();

    service = module.get(CalendarService);
  });

  // -----------------------------------------------------------------
  describe('janela consultada', () => {
    // O legado repassava `start` e `end` crus para o Prisma.
    it('recusa janela maior que o teto', async () => {
      await expect(
        service.getCalendar('teacher-user', {
          from: '2020-01-01T00:00:00.000Z',
          to: '2030-01-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa fim anterior ao início', async () => {
      await expect(
        service.getCalendar('teacher-user', {
          from: '2026-09-30T00:00:00.000Z',
          to: '2026-09-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa data inválida', async () => {
      await expect(
        service.getCalendar('teacher-user', { from: 'ontem' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('assume o mês corrente quando nada é informado', async () => {
      const result = await service.getCalendar('teacher-user', {});

      expect(result.period.from.getDate()).toBe(1);
      expect(result.period.to.getTime()).toBeGreaterThan(
        result.period.from.getTime(),
      );
    });
  });

  // -----------------------------------------------------------------
  describe('recorte por papel', () => {
    it('usa o professor quando há perfil', async () => {
      const result = await service.getCalendar('teacher-user', window);

      expect(prisma.lesson.findMany.mock.calls[0][0].where.teacherId).toBe(
        'teacher-1',
      );
      expect(result.period.role).toBe('teacher');
    });

    it('usa o aluno quando pedido', async () => {
      const result = await service.getCalendar('student-user', {
        ...window,
        as: 'student',
      });

      expect(prisma.lesson.findMany.mock.calls[0][0].where.studentId).toBe(
        'student-1',
      );
      expect(result.period.role).toBe('student');
    });

    it('recusa `as=teacher` sem perfil de professor', async () => {
      prisma.teacher.findUnique.mockResolvedValue(null);

      await expect(
        service.getCalendar('alguem', { ...window, as: 'teacher' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('o filtro de aluno só vale para o professor', async () => {
      await service.getCalendar('student-user', {
        ...window,
        as: 'student',
        studentId: 'outro-aluno',
      });

      expect(prisma.lesson.findMany.mock.calls[0][0].where.studentId).toBe(
        'student-1',
      );
    });
  });

  // -----------------------------------------------------------------
  describe('projeção dos eventos', () => {
    beforeEach(() => {
      prisma.lesson.findMany.mockResolvedValue([lessonRow()]);
    });

    // A cor era calculada na rota, prendendo a paleta do produto ao backend.
    it('não devolve cor', async () => {
      const result = await service.getCalendar('teacher-user', window);
      const event = result.events[0];

      expect(event).not.toHaveProperty('backgroundColor');
      expect(event).not.toHaveProperty('borderColor');
      expect(event).not.toHaveProperty('textColor');
      expect(event.status).toBe(LessonStatus.SCHEDULED);
    });

    it('calcula o fim a partir da duração', async () => {
      const result = await service.getCalendar('teacher-user', window);

      expect(result.events[0].end.toISOString()).toBe(
        '2026-09-15T20:00:00.000Z',
      );
    });

    it('mostra o aluno para o professor', async () => {
      const result = await service.getCalendar('teacher-user', window);

      expect(result.events[0].counterpart.name).toBe('João Silva');
      expect(result.events[0].counterpart.level).toBe('INTERMEDIATE');
    });

    it('mostra o professor para o aluno', async () => {
      const result = await service.getCalendar('student-user', {
        ...window,
        as: 'student',
      });

      expect(result.events[0].counterpart.name).toBe('Ana Costa');
    });

    it('esconde a anotação privada do professor do aluno', async () => {
      const asStudent = await service.getCalendar('student-user', {
        ...window,
        as: 'student',
      });
      const asTeacher = await service.getCalendar('teacher-user', window);

      expect(asStudent.events[0].lesson).not.toHaveProperty('teacherNotes');
      expect(asTeacher.events[0].lesson?.teacherNotes).toBe('anotação privada');
    });

    it('libera feedback só ao aluno, em aula concluída e ainda sem comentário', async () => {
      prisma.lesson.findMany.mockResolvedValue([
        lessonRow({ status: LessonStatus.COMPLETED, studentFeedback: null }),
      ]);

      const asStudent = await service.getCalendar('student-user', {
        ...window,
        as: 'student',
      });
      const asTeacher = await service.getCalendar('teacher-user', window);

      expect(asStudent.events[0].lesson?.canGiveFeedback).toBe(true);
      expect(asTeacher.events[0].lesson?.canGiveFeedback).toBe(false);
    });
  });

  // -----------------------------------------------------------------
  describe('prazos de tarefa', () => {
    // O legado tinha isso como `TODO` e nunca entregou.
    it('entram na linha do tempo', async () => {
      prisma.assignment.findMany.mockResolvedValue([assignmentRow()]);

      const result = await service.getCalendar('teacher-user', window);

      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe('assignment_due');
      expect(result.events[0].allDay).toBe(true);
    });

    it('podem ser desligados', async () => {
      await service.getCalendar('teacher-user', {
        ...window,
        includeAssignments: false,
      });

      expect(prisma.assignment.findMany).not.toHaveBeenCalled();
    });

    it('ficam ordenados junto com as aulas', async () => {
      prisma.lesson.findMany.mockResolvedValue([
        lessonRow({ scheduledAt: at('2026-09-25T19:00:00.000Z') }),
      ]);
      prisma.assignment.findMany.mockResolvedValue([assignmentRow()]);

      const result = await service.getCalendar('teacher-user', window);

      expect(result.events.map((event) => event.type)).toEqual([
        'assignment_due',
        'lesson',
      ]);
    });
  });

  // -----------------------------------------------------------------
  describe('aulas passadas sem status', () => {
    it('vêm em campo próprio, não misturadas ao período', async () => {
      prisma.lesson.findMany
        .mockResolvedValueOnce([lessonRow()])
        .mockResolvedValueOnce([lessonRow({ id: 'lesson-antiga' })]);

      const result = await service.getCalendar('teacher-user', window);

      expect(result.events).toHaveLength(1);
      expect(result.needsAttention).toHaveLength(1);
      expect(result.needsAttention[0].id).toBe('lesson-antiga');
    });

    // O legado buscava toda aula agendada anterior ao período, sem piso nem
    // teto, e ainda juntava tudo na mesma lista de eventos.
    it('a busca tem piso e teto', async () => {
      await service.getCalendar('teacher-user', window);

      const call = prisma.lesson.findMany.mock.calls[1][0];

      expect(call.where.scheduledAt.gte).toBeInstanceOf(Date);
      expect(call.where.status).toBe(LessonStatus.SCHEDULED);
      expect(call.take).toBe(50);
    });

    it('podem ser desligadas', async () => {
      await service.getCalendar('teacher-user', {
        ...window,
        includeNeedsAttention: false,
      });

      expect(prisma.lesson.findMany).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------
  describe('conflitos', () => {
    const overlapping = [
      lessonRow({ id: 'a', scheduledAt: at('2026-09-15T19:00:00.000Z') }),
      lessonRow({ id: 'b', scheduledAt: at('2026-09-15T19:30:00.000Z') }),
    ];

    it('só saem quando pedidos, e só para o professor', async () => {
      prisma.lesson.findMany.mockResolvedValue(overlapping);

      const semPedir = await service.getCalendar('teacher-user', window);
      const aluno = await service.getCalendar('student-user', {
        ...window,
        as: 'student',
        conflicts: true,
      });

      expect(semPedir).not.toHaveProperty('conflicts');
      expect(aluno).not.toHaveProperty('conflicts');
    });

    it('agrupa aulas que se sobrepõem', async () => {
      prisma.lesson.findMany.mockResolvedValue(overlapping);

      const result = await service.getCalendar('teacher-user', {
        ...window,
        conflicts: true,
      });

      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts?.[0].lessons).toHaveLength(2);
    });

    // O laço antigo empurrava os dois lados de cada par, então uma aula em três
    // sobreposições saía repetida três vezes.
    it('não repete a mesma aula no grupo', async () => {
      prisma.lesson.findMany.mockResolvedValue([
        ...overlapping,
        lessonRow({ id: 'c', scheduledAt: at('2026-09-15T19:45:00.000Z') }),
      ]);

      const result = await service.getCalendar('teacher-user', {
        ...window,
        conflicts: true,
      });

      const ids = result.conflicts?.[0].lessons.map((lesson) => lesson.id);

      expect(ids).toEqual(['a', 'b', 'c']);
      expect(new Set(ids).size).toBe(3);
    });

    // O legado agrupava por `toDateString()`, então nada que cruzasse a
    // meia-noite era comparado.
    it('enxerga choque que atravessa a meia-noite', async () => {
      prisma.lesson.findMany.mockResolvedValue([
        lessonRow({
          id: 'noite',
          scheduledAt: at('2026-09-15T23:30:00.000Z'),
          duration: 60,
        }),
        lessonRow({
          id: 'madrugada',
          scheduledAt: at('2026-09-16T00:00:00.000Z'),
          duration: 60,
        }),
      ]);

      const result = await service.getCalendar('teacher-user', {
        ...window,
        conflicts: true,
      });

      expect(result.conflicts).toHaveLength(1);
    });

    it('não acusa aulas encostadas', async () => {
      prisma.lesson.findMany.mockResolvedValue([
        lessonRow({ id: 'a', scheduledAt: at('2026-09-15T19:00:00.000Z') }),
        lessonRow({ id: 'b', scheduledAt: at('2026-09-15T20:00:00.000Z') }),
      ]);

      const result = await service.getCalendar('teacher-user', {
        ...window,
        conflicts: true,
      });

      expect(result.conflicts).toEqual([]);
    });

    it('ignora aula cancelada', async () => {
      prisma.lesson.findMany.mockResolvedValue([
        overlapping[0],
        lessonRow({
          id: 'b',
          scheduledAt: at('2026-09-15T19:30:00.000Z'),
          status: LessonStatus.CANCELLED,
        }),
      ]);

      const result = await service.getCalendar('teacher-user', {
        ...window,
        conflicts: true,
      });

      expect(result.conflicts).toEqual([]);
    });
  });

  // -----------------------------------------------------------------
  describe('estatísticas', () => {
    it('só saem quando pedidas', async () => {
      const result = await service.getCalendar('teacher-user', window);

      expect(result).not.toHaveProperty('stats');
    });

    // O denominador do legado incluía aulas futuras: uma falta e oito aulas
    // por vir davam 90% de presença, quando o número real era 50%.
    it('a taxa de presença ignora aula que ainda não aconteceu', async () => {
      prisma.lesson.findMany.mockResolvedValue([
        lessonRow({ id: '1', status: LessonStatus.COMPLETED }),
        lessonRow({ id: '2', status: LessonStatus.NO_SHOW }),
        ...Array.from({ length: 8 }, (_, index) =>
          lessonRow({ id: `f${index}`, status: LessonStatus.SCHEDULED }),
        ),
      ]);

      const result = await service.getCalendar('teacher-user', {
        ...window,
        stats: true,
      });

      expect(result.stats?.attendanceRate).toBe(50);
    });

    // 100% de presença sem nenhuma aula dada engana quem lê.
    it('a taxa é nula quando nada aconteceu ainda', async () => {
      prisma.lesson.findMany.mockResolvedValue([lessonRow()]);

      const result = await service.getCalendar('teacher-user', {
        ...window,
        stats: true,
      });

      expect(result.stats?.attendanceRate).toBeNull();
    });

    it('conta horas só de aula concluída', async () => {
      prisma.lesson.findMany.mockResolvedValue([
        lessonRow({ id: '1', status: LessonStatus.COMPLETED, duration: 90 }),
        lessonRow({ id: '2', status: LessonStatus.SCHEDULED, duration: 60 }),
      ]);

      const result = await service.getCalendar('teacher-user', {
        ...window,
        stats: true,
      });

      expect(result.stats?.lessonHours).toBe(1.5);
    });
  });

  // -----------------------------------------------------------------
  describe('horas livres', () => {
    // O legado inventava cinco dias de oito horas.
    it('sem agenda declarada, freeHours é null', async () => {
      const result = await service.getCalendar('teacher-user', {
        ...window,
        stats: true,
      });

      expect(result.stats).toMatchObject({ freeHours: null });
    });

    it('com agenda, vêm as horas e os horários livres', async () => {
      const slot = {
        start: at('2026-09-14T11:00:00.000Z'),
        end: at('2026-09-14T15:00:00.000Z'),
      };
      availability.computeFreeTime.mockResolvedValue({
        slots: [slot],
        hours: 4,
      });

      const result = await service.getCalendar('teacher-user', {
        ...window,
        stats: true,
        freeSlots: true,
      });

      expect(result.stats).toMatchObject({ freeHours: 4 });
      expect(result.freeSlots).toEqual([slot]);
    });

    it('para o aluno, nem calcula', async () => {
      prisma.teacher.findUnique.mockResolvedValue(null);

      const result = await service.getCalendar('student-user', {
        ...window,
        stats: true,
        freeSlots: true,
      });

      expect(result.stats).not.toHaveProperty('freeHours');
      expect(result).not.toHaveProperty('freeSlots');
      expect(availability.computeFreeTime).not.toHaveBeenCalled();
    });
  });
});
