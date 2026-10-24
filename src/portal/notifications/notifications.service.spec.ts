import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationStatus, NotificationType } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { SubscriptionsService } from '../../billing/services/subscriptions.service';
import { WhatsAppService } from './whatsapp.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { NotificationsService } from './notifications.service';

let whatsapp: { enabled: boolean; sendTemplate: jest.Mock };
let subscriptions: { whatsappEligible: jest.Mock };

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: {
    notification: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    user: { findUnique: jest.Mock; update: jest.Mock };
    teacher: { findUnique: jest.Mock };
    teacherStudent: { findMany: jest.Mock };
    schoolActivity: { create: jest.Mock };
  };
  let mail: { sendPortalNotice: jest.Mock };

  beforeEach(async () => {
    prisma = {
      notification: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      // Sem preferências guardadas: valem os padrões de cada tema.
      user: {
        findUnique: jest.fn().mockResolvedValue({
          email: 'ana@exemplo.test',
          notificationChannels: null,
          quietHoursStart: null,
          quietHoursEnd: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      teacher: { findUnique: jest.fn() },
      teacherStudent: { findMany: jest.fn().mockResolvedValue([]) },
      schoolActivity: { create: jest.fn().mockResolvedValue({}) },
    };
    mail = {
      sendPortalNotice: jest.fn().mockResolvedValue({ delivered: true }),
    };
    whatsapp = {
      enabled: true,
      sendTemplate: jest.fn().mockResolvedValue({ delivered: true }),
    };
    subscriptions = {
      whatsappEligible: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mail },
        {
          provide: ConfigService,
          useValue: { get: () => 'https://opusatlas.test' },
        },
        { provide: WhatsAppService, useValue: whatsapp },
        { provide: SubscriptionsService, useValue: subscriptions },
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

describe('NotificationsService — fora do portal', () => {
  let service: NotificationsService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let mail: { sendPortalNotice: jest.Mock };

  const user = (over: Record<string, unknown> = {}) => ({
    email: 'ana@exemplo.test',
    firstName: 'Ana',
    phone: null,
    isTeacher: false,
    isStudent: true,
    notificationChannels: null,
    quietHoursStart: null,
    quietHoursEnd: null,
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      notification: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(user()),
        update: jest.fn().mockResolvedValue({}),
      },
      teacher: { findUnique: jest.fn() },
      teacherStudent: { findMany: jest.fn().mockResolvedValue([]) },
      schoolActivity: { create: jest.fn().mockResolvedValue({}) },
    };
    mail = {
      sendPortalNotice: jest.fn().mockResolvedValue({ delivered: true }),
    };
    whatsapp = {
      enabled: true,
      sendTemplate: jest.fn().mockResolvedValue({ delivered: true }),
    };
    subscriptions = {
      whatsappEligible: jest.fn().mockResolvedValue(true),
    };
    const module = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mail },
        {
          provide: ConfigService,
          useValue: { get: () => 'https://opusatlas.test' },
        },
        { provide: WhatsAppService, useValue: whatsapp },
        { provide: SubscriptionsService, useValue: subscriptions },
      ],
    }).compile();
    service = module.get(NotificationsService);
  });

  const created = () => prisma.notification.create.mock.calls[0][0].data;

  // Criar o aviso não envia e-mail: marca a caixa de saída. A requisição que
  // marcou a aula não espera o SMTP.
  it('tema com e-mail ligado por padrão entra na caixa de saída, sem enviar na hora', async () => {
    await service.notify({
      userId: 'u',
      type: NotificationType.LESSON_RESCHEDULED_BY_TEACHER,
      title: 't',
      message: 'm',
    });
    expect(created().emailStatus).toBe('pending');
    expect(created().emailAfter).toBeInstanceOf(Date);
    expect(mail.sendPortalNotice).not.toHaveBeenCalled();
  });

  it('respeita quem desligou o e-mail do tema', async () => {
    prisma.user.findUnique.mockResolvedValue(
      user({ notificationChannels: { 'lesson-change': { email: false } } }),
    );
    await service.notify({
      userId: 'u',
      type: NotificationType.LESSON_RESCHEDULED_BY_TEACHER,
      title: 't',
      message: 'm',
    });
    expect(created().emailStatus).toBe('skipped');
  });

  it('aviso de tipo sem tema não passa pela caixa de saída', async () => {
    await service.notify({
      userId: 'u',
      type: NotificationType.SYSTEM_MAINTENANCE,
      title: 't',
      message: 'm',
    });
    expect(created().emailStatus).toBeUndefined();
  });

  describe('WhatsApp (Maestro)', () => {
    const withPhone = (extra: Record<string, unknown> = {}) =>
      user({
        notificationChannels: { 'lesson-reminder': { whatsapp: true } },
        phone: '+5511912345678',
        whatsappOptInAt: new Date(),
        ...extra,
      });

    it('escolhido, com telefone, aceite e Maestro: entra na caixa de saída', async () => {
      prisma.user.findUnique.mockResolvedValue(withPhone());
      await service.notify({
        userId: 'u',
        type: NotificationType.LESSON_TOMORROW,
        title: 't',
        message: 'm',
      });
      expect(created().whatsappStatus).toBe('pending');
      expect(created().whatsappAfter).toBeInstanceOf(Date);
    });

    it('a escolha antiga de "SMS" vale como WhatsApp', async () => {
      prisma.user.findUnique.mockResolvedValue(
        withPhone({
          notificationChannels: { 'lesson-reminder': { sms: true } },
        }),
      );
      await service.notify({
        userId: 'u',
        type: NotificationType.LESSON_TOMORROW,
        title: 't',
        message: 'm',
      });
      expect(created().whatsappStatus).toBe('pending');
    });

    it('sem aceite, sem Maestro ou em tema sem modelo: não sai', async () => {
      prisma.user.findUnique.mockResolvedValue(
        withPhone({ whatsappOptInAt: null }),
      );
      await service.notify({
        userId: 'u',
        type: NotificationType.LESSON_TOMORROW,
        title: 't',
        message: 'm',
      });
      expect(created().whatsappStatus).toBeNull();

      prisma.notification.create.mockClear();
      prisma.user.findUnique.mockResolvedValue(withPhone());
      subscriptions.whatsappEligible.mockResolvedValue(false);
      await service.notify({
        userId: 'u',
        type: NotificationType.LESSON_TOMORROW,
        title: 't',
        message: 'm',
      });
      expect(created().whatsappStatus).toBeNull();
    });

    it('canal desligado no servidor: fica registrado como indisponível', async () => {
      whatsapp.enabled = false;
      prisma.user.findUnique.mockResolvedValue(withPhone());
      await service.notify({
        userId: 'u',
        type: NotificationType.LESSON_TOMORROW,
        title: 't',
        message: 'm',
      });
      expect(created().whatsappStatus).toBe('unavailable');
    });

    it('a caixa de saída envia pelo modelo do tema, com título, texto e link', async () => {
      prisma.notification.findMany.mockResolvedValue([
        {
          id: 'n1',
          type: NotificationType.LESSON_TOMORROW,
          title: 'Aula amanhã',
          message: 'Piano às 15h',
          actionUrl: '/student/lessons',
          metadata: null,
          user: { phone: '+5511912345678', whatsappOptInAt: new Date() },
        },
      ]);
      const result = await service.flushWhatsApp(new Date());
      expect(whatsapp.sendTemplate).toHaveBeenCalledWith({
        to: '+5511912345678',
        template: 'opus_aula_lembrete',
        params: [
          'Aula amanhã',
          'Piano às 15h',
          'https://opusatlas.test/student/lessons',
        ],
      });
      expect(result.sent).toBe(1);
      expect(prisma.notification.update.mock.calls[0][0].data).toEqual({
        whatsappStatus: 'sent',
      });
    });

    it('erro permanente da Meta para na hora; passageiro tenta de novo', async () => {
      const pending = {
        id: 'n1',
        type: NotificationType.LESSON_TOMORROW,
        title: 't',
        message: 'm',
        actionUrl: null,
        metadata: null,
        user: { phone: '+5511912345678', whatsappOptInAt: new Date() },
      };
      prisma.notification.findMany.mockResolvedValue([pending]);
      whatsapp.sendTemplate.mockResolvedValue({
        delivered: false,
        permanent: true,
        error: 'template',
      });
      await service.flushWhatsApp(new Date());
      expect(
        prisma.notification.update.mock.calls[0][0].data.whatsappStatus,
      ).toBe('failed');

      whatsapp.sendTemplate.mockResolvedValue({ delivered: false });
      await service.flushWhatsApp(new Date());
      expect(
        prisma.notification.update.mock.calls[1][0].data.whatsappAfter,
      ).toBeInstanceOf(Date);
    });

    it('telefone e aceite: trocar o telefone pede aceite de novo; aceite sem telefone é recusado', async () => {
      await service.updatePreferences('u', { phone: '(11) 91234-5678' });
      expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({
        phone: '+5511912345678',
        whatsappOptInAt: null,
      });

      prisma.user.findUnique.mockResolvedValue(user({ phone: null }));
      await expect(
        service.updatePreferences('u', { whatsappOptIn: true }),
      ).rejects.toThrow('telefone');

      await expect(
        service.updatePreferences('u', { phone: '123' }),
      ).rejects.toThrow('Telefone inválido');
    });
  });

  it('no horário de silêncio o e-mail espera o fim dele', async () => {
    // 23h em São Paulo, silêncio das 22h às 7h → sai às 7h.
    jest.useFakeTimers().setSystemTime(new Date('2026-10-05T02:00:00Z'));
    prisma.user.findUnique.mockResolvedValue(
      user({ quietHoursStart: '22:00', quietHoursEnd: '07:00' }),
    );
    await service.notify({
      userId: 'u',
      type: NotificationType.LESSON_REQUESTED,
      title: 't',
      message: 'm',
    });
    expect((created().emailAfter as Date).toISOString()).toBe(
      '2026-10-05T10:00:00.000Z',
    );
    jest.useRealTimers();
  });

  it('envia os pendentes com o endereço completo da tela', async () => {
    prisma.notification.findMany.mockResolvedValue([
      {
        id: 'n1',
        title: 'Aula remarcada',
        message: 'm',
        actionText: 'Ver',
        actionUrl: '/student/lessons/1',
        metadata: null,
        user: { email: 'ana@exemplo.test', firstName: 'Ana' },
      },
    ]);
    const result = await service.flushEmails(new Date());
    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(mail.sendPortalNotice.mock.calls[0][1].actionUrl).toBe(
      'https://opusatlas.test/student/lessons/1',
    );
    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { emailStatus: 'sent' },
    });
  });

  it('falha passageira tenta de novo mais tarde, e desiste depois de cinco', async () => {
    mail.sendPortalNotice.mockResolvedValue({
      delivered: false,
      error: 'smtp',
    });
    const row = (attempts: number) => ({
      id: 'n1',
      title: 't',
      message: 'm',
      actionText: null,
      actionUrl: null,
      metadata: { emailAttempts: attempts },
      user: { email: 'a@b.test', firstName: 'A' },
    });

    prisma.notification.findMany.mockResolvedValue([row(0)]);
    await service.flushEmails(new Date());
    expect(
      prisma.notification.update.mock.calls[0][0].data.emailAfter,
    ).toBeInstanceOf(Date);

    prisma.notification.findMany.mockResolvedValue([row(4)]);
    await service.flushEmails(new Date());
    expect(prisma.notification.update.mock.calls[1][0].data.emailStatus).toBe(
      'failed',
    );
  });

  it('preferências mostram só os temas dos papéis da pessoa', async () => {
    const prefs = await service.getPreferences('u');
    const keys = prefs.topics.map((t) => t.key);
    expect(keys).toContain('announcement');
    expect(keys).not.toContain('absence'); // tema só de professor
    expect(prefs.whatsappAvailable).toBe(true);
    expect(prefs.whatsappOptIn).toBe(false);
  });

  it('guardar preferências ignora tema desconhecido e exige os dois horários de silêncio', async () => {
    await service.updatePreferences('u', {
      channels: {
        'lesson-reminder': { email: false },
        inventado: { email: true },
      },
      quietHoursStart: '22:00',
    });
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.notificationChannels).toEqual({
      'lesson-reminder': { email: false },
    });
    expect(data.quietHoursStart).toBeNull();
  });

  it('aviso avulso só chega a alunos do professor', async () => {
    prisma.teacher.findUnique.mockResolvedValue({
      id: 't1',
      user: { firstName: 'Helena', lastName: 'Duarte' },
    });
    prisma.teacherStudent.findMany.mockResolvedValue([
      { student: { id: 's1', userId: 'u1' } },
    ]);
    const result = await service.announce('teacher-user', {
      studentIds: ['s1', 's9'],
      title: 'Recital',
      message: 'Sábado',
    });
    expect(result).toMatchObject({ delivered: 1, skipped: 1 });
    expect(created().message).toBe('Helena Duarte: Sábado');
    // O aviso entra no histórico do professor.
    expect(prisma.schoolActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'teacher-user',
        action: 'ANNOUNCEMENT_SENT',
      }),
    });
  });
});
