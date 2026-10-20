import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SchoolActivitiesService } from '../school-activities/school-activities.service';
import { RepertoireService } from './repertoire.service';

describe('RepertoireService', () => {
  let service: RepertoireService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let notifications: { notify: jest.Mock };

  const link = (share = true) => ({
    teacherId: 't1',
    teacher: { user: { firstName: 'Helena', lastName: 'Duarte' } },
    student: { userId: 'student-user', allowProgressShare: share },
  });

  beforeEach(async () => {
    prisma = {
      teacherStudent: { findFirst: jest.fn().mockResolvedValue(link()) },
      student: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 's1', userId: 'student-user' }),
      },
      lesson: { findMany: jest.fn().mockResolvedValue([]) },
      assignment: { findMany: jest.fn().mockResolvedValue([]) },
      wantToLearn: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({ id: 'w' }),
      },
      learned: { findMany: jest.fn().mockResolvedValue([]) },
      work: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'work-1', title: 'Clair de lune' }),
      },
      workScore: { findFirst: jest.fn() },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    notifications = { notify: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        RepertoireService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: SchoolActivitiesService, useValue: { record: jest.fn() } },
      ],
    }).compile();
    service = module.get(RepertoireService);
  });

  it('o professor vê o repertório do aluno dele', async () => {
    const result = await service.ofStudent('teacher-user', 's1');
    expect(result).toEqual({ studying: [], wantToLearn: [], learned: [] });
  });

  it('respeita o aluno que não compartilha', async () => {
    prisma.teacherStudent.findFirst.mockResolvedValue(link(false));
    await expect(service.ofStudent('teacher-user', 's1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('estudando sai das aulas, com a origem mais antiga do período', async () => {
    prisma.lesson.findMany.mockResolvedValue([
      {
        id: 'l2',
        scheduledAt: new Date('2026-10-08T18:00:00Z'),
        worksIds: ['w1'],
        repertoire: [],
      },
      {
        id: 'l1',
        scheduledAt: new Date('2026-09-24T18:00:00Z'),
        worksIds: ['w1'],
        repertoire: [],
      },
    ]);
    prisma.work.findMany.mockResolvedValue([
      { id: 'w1', title: 'Noturno', composer: { id: 'c1', name: 'Chopin' } },
    ]);
    const result = await service.mine('student-user');
    expect(result.studying).toEqual([
      expect.objectContaining({ lessonId: 'l1' }),
    ]);
  });

  it('sugerir põe no "quero aprender" com quem sugeriu e avisa o aluno', async () => {
    await service.suggest('teacher-user', 's1', { workId: 'work-1' });
    expect(prisma.wantToLearn.upsert.mock.calls[0][0].create).toMatchObject({
      userId: 'student-user',
      suggestedByUserId: 'teacher-user',
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'student-user',
        type: 'WORK_SUGGESTED',
      }),
    );
  });

  it('partitura precisa ser da obra sugerida', async () => {
    prisma.workScore.findFirst.mockResolvedValue(null);
    await expect(
      service.suggest('teacher-user', 's1', {
        workId: 'work-1',
        workScoreId: 'score-x',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
