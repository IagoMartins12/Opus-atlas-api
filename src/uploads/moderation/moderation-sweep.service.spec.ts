import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../portal/notifications/notifications.service';
import { ModerationSweepService } from './moderation-sweep.service';
import { SLA_HOURS } from './moderation-sla';

describe('ModerationSweepService', () => {
  let service: ModerationSweepService;
  let prisma: {
    uploadModeration: { count: jest.Mock };
    user: { findMany: jest.Mock };
  };
  let notifications: { notifyMany: jest.Mock };

  const agora = new Date('2026-09-10T12:00:00Z');

  beforeEach(async () => {
    prisma = {
      uploadModeration: { count: jest.fn().mockResolvedValue(0) },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }]),
      },
    };

    notifications = { notifyMany: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModerationSweepService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get(ModerationSweepService);
  });

  it('confere uma prioridade por vez, cada uma com o seu corte', async () => {
    await service.sweep(agora);

    expect(prisma.uploadModeration.count).toHaveBeenCalledTimes(
      Object.keys(SLA_HOURS).length,
    );

    const urgente = prisma.uploadModeration.count.mock.calls[0][0].where;
    const horas =
      (agora.getTime() - urgente.createdAt.lt.getTime()) / 3_600_000;

    expect(urgente.status).toBe('pending');
    expect(horas).toBe(SLA_HOURS.urgent);
  });

  // Fila em dia não vira notificação: um aviso que sempre chega deixa de ser
  // lido, e nesse dia o atraso de verdade passa junto.
  it('fila em dia não avisa ninguém', async () => {
    const result = await service.sweep(agora);

    expect(result.overdue).toBe(0);
    expect(notifications.notifyMany).not.toHaveBeenCalled();
  });

  it('avisa os administradores quando há atraso', async () => {
    prisma.uploadModeration.count.mockResolvedValue(2);

    const result = await service.sweep(agora);

    expect(result.overdue).toBe(2 * Object.keys(SLA_HOURS).length);
    expect(result.notified).toBe(1);
    expect(notifications.notifyMany).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'admin-1' }),
    ]);
  });

  it('procura só quem é administrador', async () => {
    prisma.uploadModeration.count.mockResolvedValue(1);

    await service.sweep(agora);

    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
      role: { gte: 1 },
    });
  });

  // A varredura roda de hora em hora; cinco avisos idênticos no mesmo dia são
  // o mesmo que nenhum.
  it('deduplica o aviso por administrador e por dia', async () => {
    prisma.uploadModeration.count.mockResolvedValue(1);

    await service.sweep(agora);

    const [[aviso]] = notifications.notifyMany.mock.calls[0];

    expect(aviso.uniqueHash).toBe('moderation-overdue:admin-1:2026-09-10');
  });

  // A varredura não decide nada e não move conteúdo: ela avisa quem decide.
  it('não toca em conteúdo nenhum', async () => {
    prisma.uploadModeration.count.mockResolvedValue(3);

    await service.sweep(agora);

    expect(Object.keys(prisma)).toEqual(['uploadModeration', 'user']);
  });
});
