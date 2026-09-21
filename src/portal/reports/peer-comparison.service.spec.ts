import { Test, TestingModule } from '@nestjs/testing';
import { DifficultyLevel, LessonStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PeerComparisonService } from './peer-comparison.service';

describe('PeerComparisonService', () => {
  let service: PeerComparisonService;
  let prisma: {
    teacherStudent: { findMany: jest.Mock };
    lesson: { groupBy: jest.Mock };
    assignment: { groupBy: jest.Mock };
  };

  const params = {
    teacherId: 'teacher-1',
    studentId: 'student-1',
    level: DifficultyLevel.INTERMEDIATE,
    start: new Date('2026-01-01T00:00:00.000Z'),
    end: new Date('2026-06-30T00:00:00.000Z'),
  };

  const cohort = (n: number) =>
    Array.from({ length: n }, (_, index) => ({
      studentId: index === 0 ? 'student-1' : `peer-${index}`,
    }));

  beforeEach(async () => {
    prisma = {
      teacherStudent: { findMany: jest.fn().mockResolvedValue(cohort(6)) },
      lesson: { groupBy: jest.fn().mockResolvedValue([]) },
      assignment: { groupBy: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PeerComparisonService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(PeerComparisonService);
  });

  // Com poucos colegas, "a média do grupo" vira o número de uma pessoa que o
  // professor sabe identificar.
  it('não compara com grupo pequeno demais', async () => {
    prisma.teacherStudent.findMany.mockResolvedValue(cohort(3));

    const result = await service.compare(params);

    expect(result).toEqual({
      available: false,
      reason: 'cohort_too_small',
      cohortSize: 3,
      minimumCohort: 5,
    });
    expect(prisma.lesson.groupBy).not.toHaveBeenCalled();
  });

  // No legado a média era `valorDoAluno * (0.8 + Math.random() * 0.4)` — o
  // percentil mudava a cada recarga da mesma página.
  it('a média sai do banco e é estável entre chamadas', async () => {
    prisma.lesson.groupBy.mockResolvedValue([
      {
        studentId: 'student-1',
        status: LessonStatus.COMPLETED,
        _count: { _all: 10 },
      },
      {
        studentId: 'peer-1',
        status: LessonStatus.COMPLETED,
        _count: { _all: 2 },
      },
      {
        studentId: 'peer-2',
        status: LessonStatus.COMPLETED,
        _count: { _all: 4 },
      },
      {
        studentId: 'peer-3',
        status: LessonStatus.COMPLETED,
        _count: { _all: 6 },
      },
      {
        studentId: 'peer-4',
        status: LessonStatus.COMPLETED,
        _count: { _all: 8 },
      },
      {
        studentId: 'peer-5',
        status: LessonStatus.COMPLETED,
        _count: { _all: 0 },
      },
    ]);

    const primeira = await service.compare(params);
    const segunda = await service.compare(params);

    expect(primeira).toEqual(segunda);

    if ('available' in primeira) {
      throw new Error('esperava comparação disponível');
    }

    const aulas = primeira.metrics.find((m) => m.metric === 'completedLessons');

    expect(aulas?.student).toBe(10);
    expect(aulas?.cohortAverage).toBe(5);
  });

  // `ratio * 50 + 25` não é percentil de nada: quem estava exatamente na média
  // recebia 75.
  it('o percentil é a fração do grupo abaixo do aluno', async () => {
    prisma.lesson.groupBy.mockResolvedValue([
      {
        studentId: 'student-1',
        status: LessonStatus.COMPLETED,
        _count: { _all: 5 },
      },
      {
        studentId: 'peer-1',
        status: LessonStatus.COMPLETED,
        _count: { _all: 1 },
      },
      {
        studentId: 'peer-2',
        status: LessonStatus.COMPLETED,
        _count: { _all: 2 },
      },
      {
        studentId: 'peer-3',
        status: LessonStatus.COMPLETED,
        _count: { _all: 3 },
      },
      {
        studentId: 'peer-4',
        status: LessonStatus.COMPLETED,
        _count: { _all: 9 },
      },
      {
        studentId: 'peer-5',
        status: LessonStatus.COMPLETED,
        _count: { _all: 9 },
      },
    ]);

    const result = await service.compare(params);

    if ('available' in result) {
      throw new Error('esperava comparação disponível');
    }

    const aulas = result.metrics.find((m) => m.metric === 'completedLessons');

    // Três dos seis alunos estão abaixo de 5.
    expect(aulas?.percentile).toBe(50);
  });

  it('aluno sem aula no período não entra na média de presença', async () => {
    prisma.lesson.groupBy.mockResolvedValue([
      {
        studentId: 'student-1',
        status: LessonStatus.COMPLETED,
        _count: { _all: 4 },
      },
      {
        studentId: 'peer-1',
        status: LessonStatus.COMPLETED,
        _count: { _all: 2 },
      },
      {
        studentId: 'peer-1',
        status: LessonStatus.NO_SHOW,
        _count: { _all: 2 },
      },
    ]);

    const result = await service.compare(params);

    if ('available' in result) {
      throw new Error('esperava comparação disponível');
    }

    const presenca = result.metrics.find((m) => m.metric === 'attendanceRate');

    // Só dois alunos têm aula no período: 100% e 50%.
    expect(presenca?.cohortAverage).toBe(75);
  });

  it('só compara com alunos do mesmo nível e do mesmo professor', async () => {
    await service.compare(params);

    expect(prisma.teacherStudent.findMany.mock.calls[0][0].where).toEqual({
      teacherId: 'teacher-1',
      isActive: true,
      student: { is: { level: DifficultyLevel.INTERMEDIATE } },
    });
  });
});
