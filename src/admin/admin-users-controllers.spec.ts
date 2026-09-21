import type { Response } from 'express';
import { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';
import { AdminUploadsController } from './uploads/admin-uploads.controller';
import { AdminUsersController } from './users/admin-users.controller';
import { TeacherInvitationsController } from './users/teacher-invitations.controller';

const admin: AccessTokenPayload = {
  sub: 'a1',
  email: 'admin@x.com',
  role: 2,
  isTeacher: false,
  isStudent: false,
  type: 'access',
};

describe('AdminUploadsController', () => {
  it('histórico, estatísticas e contribuidores', async () => {
    const service = {
      list: jest.fn().mockResolvedValue('lista'),
      stats: jest.fn().mockResolvedValue('stats'),
      topContributors: jest.fn().mockResolvedValue('top'),
    };
    const controller = new AdminUploadsController(service as never);

    await expect(controller.list({} as never)).resolves.toBe('lista');
    await expect(controller.stats({} as never)).resolves.toBe('stats');
    await expect(controller.contributors()).resolves.toBe('top');
  });
});

describe('AdminUsersController', () => {
  const service = {
    list: jest.fn().mockResolvedValue('lista'),
    analytics: jest.fn().mockResolvedValue('analytics'),
    export: jest.fn(),
    findOne: jest.fn().mockResolvedValue('um'),
    update: jest.fn().mockResolvedValue('atualizado'),
  };
  const controller = new AdminUsersController(service as never);

  it('lista, análise, detalhe e edição com quem editou', async () => {
    await controller.list({} as never);
    await controller.analytics({} as never);
    await expect(controller.findOne('u1')).resolves.toBe('um');
    await controller.update(admin, 'u1', { isTeacher: true } as never);

    expect(service.update).toHaveBeenCalledWith('a1', 'u1', {
      isTeacher: true,
    });
  });

  it('exportação: JSON como está; CSV datado com BOM', async () => {
    const response = { setHeader: jest.fn() } as unknown as Response & {
      setHeader: jest.Mock;
    };

    service.export.mockResolvedValue({ users: [] });
    await expect(controller.export({} as never, response)).resolves.toEqual({
      users: [],
    });
    expect(response.setHeader).not.toHaveBeenCalled();

    service.export.mockResolvedValue({ csv: 'email' });
    await expect(controller.export({} as never, response)).resolves.toBe(
      '﻿email',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringMatching(
        /^attachment; filename="usuarios-\d{4}-\d{2}-\d{2}\.csv"$/,
      ),
    );
  });
});

describe('TeacherInvitationsController', () => {
  it('aceitar, recusar e reenviar pelo token', async () => {
    const service = {
      accept: jest.fn().mockResolvedValue('aceito'),
      decline: jest.fn().mockResolvedValue('recusado'),
      resend: jest.fn().mockResolvedValue('reenviado'),
    };
    const controller = new TeacherInvitationsController(service as never);

    await expect(controller.accept('t1')).resolves.toBe('aceito');
    await expect(controller.decline('t2')).resolves.toBe('recusado');
    await expect(controller.resend('t3')).resolves.toBe('reenviado');
    expect(service.decline).toHaveBeenCalledWith('t2');
  });
});
