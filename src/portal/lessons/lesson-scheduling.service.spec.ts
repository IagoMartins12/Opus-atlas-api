import { Test, TestingModule } from '@nestjs/testing';
import { RecurrenceType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LessonSchedulingService } from './lesson-scheduling.service';

const at = (iso: string) => new Date(iso);

const lesson = (overrides: Record<string, unknown> = {}) => ({
  id: 'other-lesson',
  title: 'Aula existente',
  scheduledAt: at('2026-09-15T19:00:00.000Z'),
  duration: 60,
  teacherId: 'teacher-1',
  studentId: 'student-1',
  student: { user: { firstName: 'João', lastName: 'Silva' } },
  ...overrides,
});

describe('LessonSchedulingService', () => {
  let service: LessonSchedulingService;
  let prisma: { lesson: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { lesson: { findMany: jest.fn().mockResolvedValue([]) } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LessonSchedulingService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(LessonSchedulingService);
  });

  const base = {
    teacherId: 'teacher-1',
    studentId: 'student-1',
    scheduledAt: at('2026-09-15T19:00:00.000Z'),
    duration: 60,
  };

  describe('findConflicts', () => {
    it('acusa sobreposição exata', async () => {
      prisma.lesson.findMany.mockResolvedValue([lesson()]);

      const conflicts = await service.findConflicts(base);

      expect(conflicts).toHaveLength(1);
    });

    // Comparar só os horários de início deixaria passar uma aula que começou
    // meia hora antes e ainda está acontecendo.
    it('acusa aula que começou antes e ainda não terminou', async () => {
      prisma.lesson.findMany.mockResolvedValue([
        lesson({ scheduledAt: at('2026-09-15T18:30:00.000Z'), duration: 60 }),
      ]);

      const conflicts = await service.findConflicts(base);

      expect(conflicts).toHaveLength(1);
    });

    it('não acusa aula que termina exatamente quando a nova começa', async () => {
      prisma.lesson.findMany.mockResolvedValue([
        lesson({ scheduledAt: at('2026-09-15T18:00:00.000Z'), duration: 60 }),
      ]);

      const conflicts = await service.findConflicts(base);

      expect(conflicts).toHaveLength(0);
    });

    it('não acusa aula que começa exatamente quando a nova termina', async () => {
      prisma.lesson.findMany.mockResolvedValue([
        lesson({ scheduledAt: at('2026-09-15T20:00:00.000Z'), duration: 60 }),
      ]);

      const conflicts = await service.findConflicts(base);

      expect(conflicts).toHaveLength(0);
    });

    // O legado só olhava o professor: dois professores diferentes podiam
    // agendar com o mesmo aluno no mesmo horário sem nada acusar.
    it('acusa conflito na agenda do aluno com outro professor', async () => {
      prisma.lesson.findMany.mockResolvedValue([
        lesson({ teacherId: 'outro-professor', studentId: 'student-1' }),
      ]);

      const conflicts = await service.findConflicts(base);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].clashesWith).toBe('student');
    });

    it('acusa conflito na agenda do professor com outro aluno', async () => {
      prisma.lesson.findMany.mockResolvedValue([
        lesson({ teacherId: 'teacher-1', studentId: 'outro-aluno' }),
      ]);

      const conflicts = await service.findConflicts(base);

      expect(conflicts[0].clashesWith).toBe('teacher');
    });

    it('marca como duplo quando professor e aluno são os mesmos', async () => {
      prisma.lesson.findMany.mockResolvedValue([lesson()]);

      const conflicts = await service.findConflicts(base);

      expect(conflicts[0].clashesWith).toBe('both');
    });

    it('consulta as duas agendas de uma vez', async () => {
      await service.findConflicts(base);

      expect(prisma.lesson.findMany.mock.calls[0][0].where.OR).toEqual([
        { teacherId: 'teacher-1' },
        { studentId: 'student-1' },
      ]);
    });

    // Antes a consulta não tinha piso e carregava todas as aulas já dadas pelo
    // professor desde sempre, filtrando em memória.
    it('limita a janela de busca por baixo', async () => {
      await service.findConflicts(base);

      const range = prisma.lesson.findMany.mock.calls[0][0].where.scheduledAt;

      expect(range.gte).toBeInstanceOf(Date);
      expect(range.lt).toBeInstanceOf(Date);
      expect(range.gte.getTime()).toBeLessThan(base.scheduledAt.getTime());
    });

    it('ignora a própria aula ao remarcar', async () => {
      await service.findConflicts({ ...base, excludeLessonId: 'lesson-1' });

      expect(prisma.lesson.findMany.mock.calls[0][0].where.id).toEqual({
        not: 'lesson-1',
      });
    });

    it('só considera aulas agendadas', async () => {
      await service.findConflicts(base);

      expect(prisma.lesson.findMany.mock.calls[0][0].where.status).toBe(
        'SCHEDULED',
      );
    });
  });

  describe('calculateOccurrences', () => {
    const start = at('2026-09-15T19:00:00.000Z');

    it('devolve uma única data quando não há recorrência', () => {
      const dates = service.calculateOccurrences(
        start,
        RecurrenceType.NONE,
        at('2026-12-15T19:00:00.000Z'),
      );

      expect(dates).toEqual([start]);
    });

    it('gera datas semanais', () => {
      const dates = service.calculateOccurrences(
        start,
        RecurrenceType.WEEKLY,
        at('2026-10-13T19:00:00.000Z'),
      );

      expect(dates).toHaveLength(5);
      expect(dates[1].getTime() - dates[0].getTime()).toBe(
        7 * 24 * 60 * 60 * 1000,
      );
    });

    it('gera datas quinzenais', () => {
      const dates = service.calculateOccurrences(
        start,
        RecurrenceType.BIWEEKLY,
        at('2026-10-13T19:00:00.000Z'),
      );

      expect(dates).toHaveLength(3);
    });

    it('gera datas mensais', () => {
      const dates = service.calculateOccurrences(
        start,
        RecurrenceType.MONTHLY,
        at('2026-12-15T19:00:00.000Z'),
      );

      expect(dates).toHaveLength(4);
    });

    // Alternar 3 e 4 dias reproduz o par segunda/quinta ao longo das semanas.
    it('alterna 3 e 4 dias em duas vezes por semana', () => {
      const dates = service.calculateOccurrences(
        start,
        RecurrenceType.TWICE_WEEKLY,
        at('2026-09-29T19:00:00.000Z'),
      );

      const firstGap = dates[1].getTime() - dates[0].getTime();
      const secondGap = dates[2].getTime() - dates[1].getTime();

      expect(firstGap).toBe(3 * 24 * 60 * 60 * 1000);
      expect(secondGap).toBe(4 * 24 * 60 * 60 * 1000);
    });

    // Evita uma série que nunca termina.
    it('limita o horizonte a 6 meses', () => {
      const dates = service.calculateOccurrences(
        start,
        RecurrenceType.MONTHLY,
        at('2030-01-01T19:00:00.000Z'),
      );

      expect(dates.length).toBeLessThanOrEqual(7);
    });

    // Protege de uma recorrência curta que geraria centenas de registros.
    it('limita o número de ocorrências', () => {
      const dates = service.calculateOccurrences(
        start,
        RecurrenceType.TWICE_WEEKLY,
        at('2027-03-15T19:00:00.000Z'),
      );

      expect(dates.length).toBeLessThanOrEqual(60);
    });
  });

  describe('suggestAlternatives', () => {
    it('sugere horários livres no mesmo dia', async () => {
      prisma.lesson.findMany.mockResolvedValue([]);

      const suggestions = await service.suggestAlternatives(base);

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions).not.toContainEqual(base.scheduledAt);
    });

    it('não sugere horário ocupado', async () => {
      // A janela de trabalho é montada em hora LOCAL (08h às 21h), então o
      // bloco ocupado precisa ser construído na mesma base — usar um horário
      // fixo em UTC daria um resultado diferente conforme o fuso da máquina.
      const dayStart = new Date(base.scheduledAt);
      dayStart.setHours(8, 0, 0, 0);

      prisma.lesson.findMany.mockResolvedValue([
        lesson({ scheduledAt: dayStart, duration: 13 * 60 }),
      ]);

      const suggestions = await service.suggestAlternatives(base);

      expect(suggestions).toHaveLength(0);
    });

    // O legado fazia uma consulta por horário testado.
    it('usa uma única consulta para o dia inteiro', async () => {
      await service.suggestAlternatives(base);

      expect(prisma.lesson.findMany).toHaveBeenCalledTimes(1);
    });
  });
});
