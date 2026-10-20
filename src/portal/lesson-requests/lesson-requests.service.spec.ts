import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { LessonsService } from '../lessons/lessons.service';
import { ScheduleRulesService } from '../lessons/schedule-rules.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SchoolActivitiesService } from '../school-activities/school-activities.service';
import { LessonRequestsService } from './lesson-requests.service';

const inHours = (h: number) =>
  new Date(Date.now() + h * 3_600_000).toISOString();

describe('LessonRequestsService', () => {
  let service: LessonRequestsService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let rules: { check: jest.Mock };
  let lessons: { create: jest.Mock };
  let notifications: { notify: jest.Mock };

  const check = (severity: string, codes: string[] = []) => ({
    occurrences: [
      {
        severity,
        findings: codes.map((code) => ({
          code,
          severity: 'warning',
          message: '',
        })),
        suggestions: [],
      },
    ],
  });

  beforeEach(async () => {
    prisma = {
      student: {
        findUnique: jest.fn().mockResolvedValue({
          id: 's1',
          user: { firstName: 'Marina', lastName: 'Costa' },
        }),
      },
      teacherStudent: {
        findFirst: jest.fn().mockResolvedValue({
          lessonDuration: 60,
          teacher: {
            id: 't1',
            userId: 'teacher-user',
            acceptsLessonRequests: true,
            requestLeadHours: 12,
            requestHorizonDays: 45,
            defaultLessonDuration: 60,
          },
        }),
      },
      lessonRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'r1' }),
        update: jest.fn().mockResolvedValue({ id: 'r1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
        findUniqueOrThrow: jest.fn(),
      },
    };
    rules = { check: jest.fn().mockResolvedValue(check('ok')) };
    lessons = {
      create: jest
        .fn()
        .mockResolvedValue({ lessons: [{ id: 'l1' }], created: 1 }),
    };
    notifications = { notify: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        LessonRequestsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScheduleRulesService, useValue: rules },
        { provide: LessonsService, useValue: lessons },
        { provide: NotificationsService, useValue: notifications },
        { provide: SchoolActivitiesService, useValue: { record: jest.fn() } },
      ],
    }).compile();
    service = module.get(LessonRequestsService);
  });

  const dto = (hours = 48) => ({
    teacherId: 't1',
    scheduledAt: inHours(hours),
  });

  it('pede num horário livre e avisa o professor', async () => {
    await service.create('student-user', dto());
    expect(prisma.lessonRequest.create).toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'teacher-user',
        type: 'LESSON_REQUESTED',
      }),
    );
  });

  it('respeita a antecedência do professor', async () => {
    await expect(service.create('student-user', dto(3))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('respeita até quantos dias à frente', async () => {
    await expect(service.create('student-user', dto(24 * 60))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('professor que não recebe pedidos', async () => {
    prisma.teacherStudent.findFirst.mockResolvedValue({
      lessonDuration: 60,
      teacher: {
        id: 't1',
        userId: 'teacher-user',
        acceptsLessonRequests: false,
        requestLeadHours: 12,
        requestHorizonDays: 45,
        defaultLessonDuration: 60,
      },
    });
    await expect(service.create('student-user', dto())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('horário com conflito barra o pedido', async () => {
    rules.check.mockResolvedValue(check('conflict'));
    await expect(service.create('student-user', dto())).rejects.toThrow(
      ConflictException,
    );
  });

  // Pedir é escolher uma hora livre: fora do atendimento não é hora livre.
  it('fora do atendimento barra o pedido', async () => {
    rules.check.mockResolvedValue(check('warning', ['OUTSIDE_AVAILABILITY']));
    await expect(service.create('student-user', dto())).rejects.toThrow(
      ConflictException,
    );
  });

  it('aviso do plano não barra o pedido', async () => {
    rules.check.mockResolvedValue(check('warning', ['STUDENT_WEEK_PLAN']));
    await expect(service.create('student-user', dto())).resolves.toBeDefined();
  });

  // Aceitar passa pela mesma porta da marcação do professor.
  it('aceitar marca a aula pelas regras de sempre e avisa o aluno', async () => {
    prisma.lessonRequest.findFirst.mockResolvedValue({
      id: 'r1',
      status: 'PENDING',
      scheduledAt: new Date(inHours(48)),
      duration: 60,
      studentId: 's1',
      student: { userId: 'student-user' },
    });
    await service.accept('teacher-user', 'r1', {});
    expect(lessons.create).toHaveBeenCalledWith(
      'teacher-user',
      expect.objectContaining({ studentId: 's1', duration: 60 }),
    );
    expect(prisma.lessonRequest.update.mock.calls[0][0].data).toMatchObject({
      status: 'ACCEPTED',
      lessonId: 'l1',
    });
  });

  it('pedido já respondido não se aceita de novo', async () => {
    prisma.lessonRequest.findFirst.mockResolvedValue({
      id: 'r1',
      status: 'DECLINED',
      scheduledAt: new Date(inHours(48)),
      duration: 60,
      studentId: 's1',
      student: { userId: 'student-user' },
    });
    await expect(service.accept('teacher-user', 'r1', {})).rejects.toThrow(
      BadRequestException,
    );
  });
});
