import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { SchoolActivitiesService } from '../school-activities/school-activities.service';
import { PracticeService } from './practice.service';

describe('PracticeService', () => {
  let service: PracticeService;
  let prisma: Record<string, Record<string, jest.Mock>>;

  let activities: { record: jest.Mock };

  beforeEach(async () => {
    activities = { record: jest.fn() };
    prisma = {
      student: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 's1', practiceTime: 240 }),
        update: jest.fn().mockResolvedValue({}),
      },
      practiceLog: {
        create: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'p1', ...args.data }),
        ),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ minutes: 60, topic: null }),
        delete: jest.fn().mockResolvedValue({}),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      teacherStudent: { findFirst: jest.fn() },
      work: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'w1',
            title: 'Noturno op. 9 nº 2',
            composer: { name: 'Chopin' },
          },
        ]),
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        PracticeService,
        { provide: PrismaService, useValue: prisma },
        { provide: SchoolActivitiesService, useValue: activities },
      ],
    }).compile();
    service = module.get(PracticeService);
  });

  it('registra a prática do próprio aluno', async () => {
    const entry = await service.log('u1', { minutes: 30, topic: '  Escalas ' });
    expect(entry).toMatchObject({
      studentId: 's1',
      minutes: 30,
      topic: 'Escalas',
    });
  });

  it('recusa prática no futuro', async () => {
    await expect(
      service.log('u1', {
        minutes: 30,
        practicedAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('quem não é aluno não registra', async () => {
    prisma.student.findUnique.mockResolvedValue(null);
    await expect(service.log('u1', { minutes: 10 })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('soma por dia no fuso do Brasil e por obra', async () => {
    prisma.practiceLog.findMany.mockResolvedValue([
      // 23h30 de Brasília do dia 4 é dia 5 em UTC: conta no dia 4.
      {
        id: 'a',
        practicedAt: new Date('2026-10-05T02:30:00Z'),
        minutes: 30,
        workId: 'w1',
        topic: null,
        note: null,
      },
      {
        id: 'b',
        practicedAt: new Date('2026-10-04T12:00:00Z'),
        minutes: 15,
        workId: null,
        topic: 'Escalas',
        note: null,
      },
    ]);
    const result = await service.list('u1', {});
    expect(result.days).toEqual([{ date: '2026-10-04', minutes: 45 }]);
    expect(result.subjects).toEqual([
      { subject: 'Noturno op. 9 nº 2', minutes: 30 },
      { subject: 'Escalas', minutes: 15 },
    ]);
    expect(result.weeklyGoalMinutes).toBe(240);
  });

  // O professor lê o diário do aluno — inclusive depois de encerrado o vínculo.
  it('o professor só lê o diário de aluno dele', async () => {
    prisma.teacherStudent.findFirst.mockResolvedValue(null);
    await expect(
      service.list('teacher-user', { studentId: 's9' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('apagar só o próprio registro', async () => {
    prisma.practiceLog.findFirst.mockResolvedValue(null);
    await expect(service.remove('u1', 'p9')).rejects.toThrow(NotFoundException);
    expect(prisma.practiceLog.delete).not.toHaveBeenCalled();
  });

  it('apagar entra no histórico do aluno', async () => {
    await service.remove('u1', 'p1');
    expect(prisma.practiceLog.delete).toHaveBeenCalledWith({
      where: { id: 'p1' },
    });
    expect(activities.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PRACTICE_REMOVED',
        entityType: 'practice',
        entityId: 'p1',
      }),
    );
  });
});
