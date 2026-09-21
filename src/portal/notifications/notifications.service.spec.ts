import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationStatus, NotificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: {
    notification: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      notification: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  const whereOf = () => prisma.notification.findMany.mock.calls[0][0].where;

  describe('list', () => {
    // O legado filtrava só por `expiresAt: { gte: now }`, o que descartava
    // silenciosamente toda notificação sem prazo — e nenhuma das notificações
    // de evento real define prazo. Elas eram criadas e nunca apareciam.
    it('inclui notificações sem prazo definido', async () => {
      await service.list('user-1', {});

      expect(whereOf().OR).toEqual([
        { expiresAt: null },
        { expiresAt: { isSet: false } },
        { expiresAt: { gte: expect.any(Date) } },
      ]);
    });

    // Três casos, não dois. No MongoDB, campo nunca escrito fica **ausente**,
    // e o Prisma distingue ausente de nulo — medido na base: um filtro por
    // `null` num campo ausente devolve zero. Como `notify()` omite `expiresAt`
    // quando não há prazo, sem este ramo a correção original seguiria valendo
    // só no papel.
    it('alcança também o campo ausente, não só o nulo', async () => {
      await service.list('user-1', {});

      expect(whereOf().OR).toContainEqual({ expiresAt: { isSet: false } });
    });

    it('permite pedir também as expiradas', async () => {
      await service.list('user-1', { includeExpired: true });

      expect(whereOf()).not.toHaveProperty('OR');
    });

    it('restringe ao usuário que chamou', async () => {
      await service.list('user-1', {});

      expect(whereOf().userId).toBe('user-1');
    });

    it('filtra por situação quando pedido', async () => {
      await service.list('user-1', { status: NotificationStatus.UNREAD });

      expect(whereOf().status).toBe(NotificationStatus.UNREAD);
    });

    // Urgente acima de informativo, e o mais recente primeiro dentro da mesma
    // prioridade.
    it('ordena por prioridade e depois por data', async () => {
      await service.list('user-1', {});

      expect(prisma.notification.findMany.mock.calls[0][0].orderBy).toEqual([
        { priority: 'desc' },
        { createdAt: 'desc' },
      ]);
    });

    it('devolve o total de não lidas junto da página', async () => {
      prisma.notification.count
        .mockResolvedValueOnce(42)
        .mockResolvedValueOnce(7);

      const result = await service.list('user-1', { page: 1, limit: 20 });

      expect(result.pagination.total).toBe(42);
      expect(result.unreadCount).toBe(7);
      expect(result.pagination.totalPages).toBe(3);
    });
  });

  describe('pendingToShow', () => {
    it('pede as não exibidas em toast', async () => {
      await service.pendingToShow('user-1', 'toast');

      expect(whereOf()).toMatchObject({
        showInToast: true,
        toastShown: false,
        status: NotificationStatus.UNREAD,
      });
    });

    it('pede as não exibidas no navegador', async () => {
      await service.pendingToShow('user-1', 'browser');

      expect(whereOf()).toMatchObject({
        showInBrowser: true,
        browserShown: false,
      });
    });

    it('ignora as expiradas', async () => {
      await service.pendingToShow('user-1', 'toast');

      expect(whereOf().OR).toBeDefined();
    });
  });

  describe('markAsRead', () => {
    // `updateMany` com o `userId` no filtro é o que impede marcar como lida a
    // notificação de outra pessoa conhecendo o id dela.
    it('restringe a atualização ao dono da notificação', async () => {
      await service.markAsRead('user-1', 'notif-1');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif-1', userId: 'user-1' },
        }),
      );
    });

    it('responde 404 quando a notificação não é do usuário', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.markAsRead('user-1', 'notif-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('markAsShown', () => {
    it('registra exibição em toast com a data', async () => {
      await service.markAsShown('user-1', 'notif-1', { channel: 'toast' });

      expect(
        prisma.notification.updateMany.mock.calls[0][0].data,
      ).toMatchObject({ toastShown: true });
    });

    it('registra exibição no navegador', async () => {
      await service.markAsShown('user-1', 'notif-1', { channel: 'browser' });

      expect(
        prisma.notification.updateMany.mock.calls[0][0].data,
      ).toMatchObject({ browserShown: true });
    });
  });

  describe('notify', () => {
    it('cria a notificação com prioridade padrão', async () => {
      await service.notify({
        userId: 'user-1',
        type: NotificationType.WELCOME_NEW_STUDENT,
        title: 'Bem-vindo',
        message: 'Olá',
      });

      expect(prisma.notification.create.mock.calls[0][0].data.priority).toBe(
        'MEDIUM',
      );
    });

    // Notificar é efeito colateral de uma ação que já aconteceu; falhar aqui
    // não pode desfazer o agendamento nem devolver erro a quem agendou.
    it('nunca lança quando a gravação falha', async () => {
      prisma.notification.create.mockRejectedValue(new Error('banco fora'));

      await expect(
        service.notify({
          userId: 'user-1',
          type: NotificationType.WELCOME_NEW_STUDENT,
          title: 'x',
          message: 'y',
        }),
      ).resolves.toBeUndefined();
    });

    // Evita avisar cinco vezes sobre a mesma aula.
    it('não duplica quando já existe uma não lida com o mesmo hash', async () => {
      prisma.notification.findFirst.mockResolvedValue({ id: 'existente' });

      await service.notify({
        userId: 'user-1',
        type: NotificationType.LESSON_TOMORROW,
        title: 'Aula amanhã',
        message: 'x',
        uniqueHash: 'lesson-1-tomorrow',
      });

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('cria quando o hash ainda não existe', async () => {
      await service.notify({
        userId: 'user-1',
        type: NotificationType.LESSON_TOMORROW,
        title: 'Aula amanhã',
        message: 'x',
        uniqueHash: 'lesson-1-tomorrow',
      });

      expect(prisma.notification.create).toHaveBeenCalled();
    });
  });

  describe('markAllAsRead', () => {
    it('devolve quantas foram marcadas', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 5 });

      expect(await service.markAllAsRead('user-1')).toBe(5);
    });

    it('só toca nas não lidas do próprio usuário', async () => {
      await service.markAllAsRead('user-1');

      expect(prisma.notification.updateMany.mock.calls[0][0].where).toEqual({
        userId: 'user-1',
        status: NotificationStatus.UNREAD,
      });
    });
  });
});
