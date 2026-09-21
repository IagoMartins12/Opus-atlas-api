import type { Request, Response } from 'express';
import { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';
import { AssignmentsController } from './assignments/assignments.controller';
import { AvailabilityController } from './availability/availability.controller';
import { CalendarController } from './calendar/calendar.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { LessonsController } from './lessons/lessons.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { RelationshipsController } from './relationships/relationships.controller';
import { ReportsController } from './reports/reports.controller';
import { SchoolActivitiesController } from './school-activities/school-activities.controller';

const user: AccessTokenPayload = {
  sub: 'u1',
  email: 'a@x.com',
  role: 0,
  isTeacher: true,
  isStudent: false,
  type: 'access',
};

function echoMock(...methods: string[]): Record<string, jest.Mock> {
  return Object.fromEntries(
    methods.map((m) => [m, jest.fn().mockResolvedValue(m)]),
  );
}
const as = <T>(value: unknown) => value as T;

describe('RelationshipsController', () => {
  const service = echoMock(
    'inviteStudent',
    'listStudents',
    'searchInvitableUsers',
    'resendInvitation',
    'updateRelationship',
    'endRelationship',
    'listTeachers',
    'acceptInvitation',
    'declineInvitation',
  );
  const controller = new RelationshipsController(as(service));

  it('convite leva IP real e navegador', async () => {
    await controller.inviteStudent(
      user,
      {} as never,
      {
        headers: { 'x-forwarded-for': '9.9.9.9, 1.1.1.1', 'user-agent': 'UA' },
      } as unknown as Request,
    );
    expect(service.inviteStudent).toHaveBeenCalledWith(
      'u1',
      {},
      { ipAddress: '9.9.9.9', userAgent: 'UA' },
    );

    await controller.resendInvite(user, 'r1', {
      headers: {},
      ip: '2.2.2.2',
    } as unknown as Request);
    expect(service.resendInvitation).toHaveBeenCalledWith('u1', 'r1', {
      ipAddress: '2.2.2.2',
      userAgent: undefined,
    });
  });

  it('lista, busca (termo vazio vira ""), edita, encerra e responde convite', async () => {
    await controller.listStudents(user, {} as never);
    await controller.searchInvitable(user, undefined as unknown as string);
    await controller.updateRelationship(user, 'r1', {} as never);
    await controller.endRelationship(user, 'r1', 'mudou');
    await controller.listTeachers(user);
    await controller.acceptInvite('t1');
    await controller.declineInvite('t2');

    expect(service.searchInvitableUsers).toHaveBeenCalledWith('u1', '');
    expect(service.endRelationship).toHaveBeenCalledWith('u1', 'r1', 'mudou');
    expect(service.acceptInvitation).toHaveBeenCalledWith('t1');
  });
});

describe('AssignmentsController e LessonsController', () => {
  it('tarefas', async () => {
    const service = echoMock(
      'create',
      'list',
      'findOne',
      'update',
      'giveFeedback',
      'remove',
      'updateProgress',
      'addSubmission',
      'removeSubmission',
      'complete',
    );
    const controller = new AssignmentsController(as(service));

    await controller.create(user, {} as never);
    await controller.list(user, {} as never);
    await controller.findOne(user, 'a1');
    await controller.update(user, 'a1', {} as never);
    await controller.giveFeedback(user, 'a1', {} as never);
    await controller.remove(user, 'a1');
    await controller.updateProgress(user, 'a1', {} as never);
    await controller.addSubmission(user, 'a1', {} as never);
    await controller.removeSubmission(user, 'a1', 's1');
    await controller.complete(user, 'a1', {} as never);

    expect(service.removeSubmission).toHaveBeenCalledWith('u1', 'a1', 's1');
    expect(service.complete).toHaveBeenCalledWith('u1', 'a1', {});
  });

  it('aulas', async () => {
    const service = echoMock(
      'create',
      'list',
      'findOne',
      'update',
      'reschedule',
      'cancel',
      'complete',
      'submitStudentFeedback',
    );
    const controller = new LessonsController(as(service));

    await controller.create(user, {} as never);
    await controller.list(user, {} as never);
    await controller.findOne(user, 'l1');
    await controller.update(user, 'l1', {} as never);
    await controller.reschedule(user, 'l1', {} as never);
    await controller.cancel(user, 'l1', {} as never);
    await controller.complete(user, 'l1', {} as never);
    await controller.feedback(user, 'l1', {} as never);

    expect(service.submitStudentFeedback).toHaveBeenCalledWith('u1', 'l1', {});
  });
});

describe('ReportsController', () => {
  const reports = echoMock('generate');
  const shared = echoMock(
    'share',
    'list',
    'findOne',
    'update',
    'revoke',
    'listComments',
    'addComment',
  );
  const controller = new ReportsController(as(reports), as(shared));

  it('gera, compartilha e comenta; página inválida vira 1', async () => {
    await controller.generate(user, 's1', {} as never);
    await controller.share(user, {} as never);
    await controller.list(user, {} as never);
    await controller.findOne(user, 'r1');
    await controller.update(user, 'r1', {} as never);
    await controller.revoke(user, 'r1');
    await controller.listComments(user, 'r1', 'abc');
    await controller.listComments(user, 'r1', '3');
    await controller.addComment(user, 'r1', {} as never);

    expect(reports.generate).toHaveBeenCalledWith('u1', 's1', {});
    expect(shared.listComments.mock.calls.map(([, , page]) => page)).toEqual([
      1, 3,
    ]);
  });
});

describe('NotificationsController', () => {
  const service = {
    list: jest.fn().mockResolvedValue('lista'),
    unreadCount: jest.fn().mockResolvedValue(4),
    pendingToShow: jest.fn().mockResolvedValue([]),
    markAsRead: jest.fn(),
    markAllAsRead: jest.fn().mockResolvedValue(7),
    markAsShown: jest.fn(),
    dismiss: jest.fn(),
  };
  const controller = new NotificationsController(as(service));

  it('contagens embrulhadas e canal padrão "toast"', async () => {
    await expect(controller.list(user, {} as never)).resolves.toBe('lista');
    await expect(controller.unreadCount(user)).resolves.toEqual({
      unreadCount: 4,
    });
    await expect(controller.markAllAsRead(user)).resolves.toEqual({
      updated: 7,
    });

    await controller.pending(user);
    await controller.pending(user, 'browser');
    expect(
      service.pendingToShow.mock.calls.map(([, channel]) => channel),
    ).toEqual(['toast', 'browser']);
  });

  it('ler, mostrar e dispensar', async () => {
    await controller.markAsRead(user, 'n1');
    await controller.markAsShown(user, 'n1', {} as never);
    await controller.dismiss(user, 'n1');

    expect(service.dismiss).toHaveBeenCalledWith('u1', 'n1');
  });
});

describe('agenda, atividades, perfil, calendário e painel', () => {
  it('agenda de disponibilidade', async () => {
    const service = echoMock(
      'getMine',
      'replaceWeekly',
      'addBlock',
      'removeBlock',
      'freeSlotsOf',
    );
    const controller = new AvailabilityController(as(service));

    await controller.getMine(user);
    await controller.replaceWeekly(user, {} as never);
    await controller.addBlock(user, {} as never);
    await controller.removeBlock(user, 'b1');
    await controller.freeSlots(user, 't1', {} as never);

    expect(service.freeSlotsOf).toHaveBeenCalledWith('u1', 't1', {});
  });

  it('atividades escolares: JSON como está; CSV com BOM e nome codificado', async () => {
    const service = {
      list: jest.fn().mockResolvedValue('lista'),
      export: jest.fn(),
    };
    const controller = new SchoolActivitiesController(as(service));
    const response = { setHeader: jest.fn() } as unknown as Response;

    await expect(controller.list(user, {} as never)).resolves.toBe('lista');

    service.export.mockResolvedValue({ items: [] });
    await expect(
      controller.export(user, {} as never, response),
    ).resolves.toEqual({ items: [] });

    service.export.mockResolvedValue({ csv: 'a,b' });
    await expect(
      controller.export(user, { filename: 'turma a' } as never, response),
    ).resolves.toBe('﻿a,b');
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="turma%20a.csv"',
    );

    await controller.export(user, {} as never, response);
    expect(response.setHeader).toHaveBeenLastCalledWith(
      'Content-Disposition',
      'attachment; filename="atividades.csv"',
    );
  });

  it('calendário e painel', async () => {
    const calendar = echoMock('getCalendar');
    const dashboard = echoMock('getDashboard');

    await new CalendarController(as(calendar)).getCalendar(user, {} as never);
    await new DashboardController(as(dashboard)).getDashboard(
      user,
      {} as never,
    );
    expect(calendar.getCalendar).toHaveBeenCalledWith('u1', {});
    expect(dashboard.getDashboard).toHaveBeenCalledWith('u1', {});
  });
});
