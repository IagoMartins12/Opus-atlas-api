import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { LessonStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AvailabilityService } from './availability.service';

const TEACHER_USER = '64b000000000000000000001';
const STUDENT_USER = '64b000000000000000000002';
const BLOCK_ID = '64b0000000000000000000bb';

describe('AvailabilityService', () => {
  let prisma: {
    teacher: { findUnique: jest.Mock; update: jest.Mock };
    teacherAvailability: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
      createMany: jest.Mock;
    };
    teacherAvailabilityBlock: {
      findMany: jest.Mock;
      create: jest.Mock;
      deleteMany: jest.Mock;
    };
    teacherStudent: { findFirst: jest.Mock };
    lesson: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: AvailabilityService;

  beforeEach(() => {
    prisma = {
      teacher: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'teacher-1',
          userId: TEACHER_USER,
          timezone: 'America/Sao_Paulo',
          acceptsLessonRequests: true,
          requestLeadHours: 12,
          requestHorizonDays: 45,
        }),
        update: jest.fn().mockReturnValue('update-tz'),
      },
      teacherAvailability: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockReturnValue('delete'),
        createMany: jest.fn().mockReturnValue('create'),
      },
      teacherAvailabilityBlock: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: BLOCK_ID }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      teacherStudent: { findFirst: jest.fn().mockResolvedValue(null) },
      lesson: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    service = new AvailabilityService(prisma as unknown as PrismaService);
  });

  describe('agenda semanal', () => {
    it('substitui a semana inteira numa transação', async () => {
      await service.replaceWeekly(TEACHER_USER, {
        slots: [{ weekday: 1, startTime: '08:00', endTime: '12:00' }],
      });

      expect(prisma.$transaction).toHaveBeenCalledWith(['delete', 'create']);
      expect(prisma.teacherAvailability.createMany).toHaveBeenCalledWith({
        data: [
          {
            teacherId: 'teacher-1',
            weekday: 1,
            startTime: '08:00',
            endTime: '12:00',
          },
        ],
      });
    });

    it('troca o fuso junto, quando vem', async () => {
      await service.replaceWeekly(TEACHER_USER, {
        slots: [{ weekday: 1, startTime: '08:00', endTime: '12:00' }],
        timezone: 'America/Manaus',
      });

      expect(prisma.$transaction).toHaveBeenCalledWith([
        'delete',
        'create',
        'update-tz',
      ]);
    });

    // Achado com a API de pé: createMany com lista vazia dava 500 no MongoDB.
    it('lista vazia apaga a agenda sem chamar createMany', async () => {
      await service.replaceWeekly(TEACHER_USER, { slots: [] });

      expect(prisma.$transaction).toHaveBeenCalledWith(['delete']);
      expect(prisma.teacherAvailability.createMany).not.toHaveBeenCalled();
    });

    it('recusa sobreposição, sem gravar', async () => {
      await expect(
        service.replaceWeekly(TEACHER_USER, {
          slots: [
            { weekday: 1, startTime: '08:00', endTime: '12:00' },
            { weekday: 1, startTime: '11:00', endTime: '13:00' },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('recusa fuso desconhecido', async () => {
      await expect(
        service.replaceWeekly(TEACHER_USER, {
          slots: [],
          timezone: 'Brasil/Qualquer',
        }),
      ).rejects.toThrow(/Fuso desconhecido/);
    });

    it('quem não é professor não tem agenda', async () => {
      prisma.teacher.findUnique.mockResolvedValue(null);

      await expect(service.getMine(STUDENT_USER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('bloqueios', () => {
    it('recusa período invertido', async () => {
      await expect(
        service.addBlock(TEACHER_USER, {
          startsAt: '2026-12-20T00:00:00Z',
          endsAt: '2026-12-10T00:00:00Z',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    // Bloqueio de outro professor responde como inexistente.
    it('só apaga bloqueio próprio', async () => {
      prisma.teacherAvailabilityBlock.deleteMany.mockResolvedValue({
        count: 0,
      });

      await expect(
        service.removeBlock(TEACHER_USER, BLOCK_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.teacherAvailabilityBlock.deleteMany).toHaveBeenCalledWith({
        where: { id: BLOCK_ID, teacherId: 'teacher-1' },
      });
    });
  });

  describe('quem vê as horas livres', () => {
    const query = {
      from: '2026-09-14T00:00:00Z',
      to: '2026-09-21T00:00:00Z',
    };

    it('o próprio professor', async () => {
      await expect(
        service.freeSlotsOf(TEACHER_USER, TEACHER_USER, query),
      ).resolves.toMatchObject({ freeHours: null });
    });

    it('aluno com vínculo aceito e ativo', async () => {
      prisma.teacherStudent.findFirst.mockResolvedValue({ id: 'link' });

      await expect(
        service.freeSlotsOf(STUDENT_USER, TEACHER_USER, query),
      ).resolves.toMatchObject({ timezone: 'America/Sao_Paulo' });
    });

    // O aluno só vê o que dá para pedir: sem as aulas dele em outra turma.
    it('para o aluno, tira as aulas que ele já tem em qualquer turma', async () => {
      prisma.teacherStudent.findFirst.mockResolvedValue({
        id: 'link',
        studentId: 'student-1',
      });
      prisma.teacherAvailability.findMany.mockResolvedValue(
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          startTime: '08:00',
          endTime: '20:00',
        })),
      );
      const inTwoDays = new Date(Date.now() + 2 * 24 * 3_600_000);
      inTwoDays.setUTCHours(15, 0, 0, 0);
      // A primeira busca de aulas é a do professor; a segunda, a do aluno.
      prisma.lesson.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ scheduledAt: inTwoDays, duration: 60 }]);

      const result = await service.freeSlotsOf(STUDENT_USER, TEACHER_USER, {
        from: new Date().toISOString(),
        to: new Date(Date.now() + 5 * 24 * 3_600_000).toISOString(),
      });

      const clash = result.slots.some(
        (slot) =>
          slot.start < new Date(inTwoDays.getTime() + 3_600_000) &&
          slot.end > inTwoDays,
      );
      expect(clash).toBe(false);
      expect(result.requests).toEqual({
        accepts: true,
        leadHours: 12,
        horizonDays: 45,
      });
      expect(prisma.lesson.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ studentId: 'student-1' }),
        }),
      );
    });

    it('professor que não aceita pedidos não oferece horário', async () => {
      prisma.teacherStudent.findFirst.mockResolvedValue({
        id: 'link',
        studentId: 'student-1',
      });
      prisma.teacher.findUnique.mockResolvedValue({
        id: 'teacher-1',
        userId: TEACHER_USER,
        timezone: 'America/Sao_Paulo',
        acceptsLessonRequests: false,
        requestLeadHours: 12,
        requestHorizonDays: 45,
      });

      const result = await service.freeSlotsOf(STUDENT_USER, TEACHER_USER, {
        from: new Date().toISOString(),
        to: new Date(Date.now() + 5 * 24 * 3_600_000).toISOString(),
      });

      expect(result.slots).toEqual([]);
      expect(result.requests.accepts).toBe(false);
    });

    it('mais ninguém', async () => {
      await expect(
        service.freeSlotsOf(STUDENT_USER, TEACHER_USER, query),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('janela grande demais é 400', async () => {
      await expect(
        service.freeSlotsOf(TEACHER_USER, TEACHER_USER, {
          from: '2026-01-01T00:00:00Z',
          to: '2026-12-31T00:00:00Z',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('aula cancelada não ocupa horário', async () => {
    await service.computeFreeTime(
      'teacher-1',
      'America/Sao_Paulo',
      new Date('2026-09-14T00:00:00Z'),
      new Date('2026-09-21T00:00:00Z'),
    );

    expect(prisma.lesson.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { not: LessonStatus.CANCELLED },
        }),
      }),
    );
  });
});
