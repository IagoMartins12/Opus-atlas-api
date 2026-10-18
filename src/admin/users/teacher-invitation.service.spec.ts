import { SubscriptionsService } from '../../billing/services/subscriptions.service';
import { BadRequestException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokenType } from '@prisma/client';
import { UserTokenService } from '../../auth/user-token.service';
import { AppCacheService } from '../../common/cache/cache.service';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TeacherInvitationService } from './teacher-invitation.service';

describe('TeacherInvitationService', () => {
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    teacher: { update: jest.Mock };
    userToken: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let tokens: {
    createToken: jest.Mock;
    validateToken: jest.Mock;
    markTokenAsUsed: jest.Mock;
    revokeAllUserTokens: jest.Mock;
    checkRateLimit: jest.Mock;
  };
  let mail: { sendTeacherInvitationEmail: jest.Mock };
  let service: TeacherInvitationService;
  let subscriptions: { grantPlan: jest.Mock };

  const invited = (status = 'PENDING') => ({
    isTeacher: true,
    teacherProfile: { id: 'teacher-1', status },
  });

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(invited()),
        update: jest.fn().mockReturnValue('user-update'),
      },
      teacher: { update: jest.fn().mockReturnValue('teacher-update') },
      userToken: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    tokens = {
      createToken: jest.fn().mockResolvedValue('tok'),
      validateToken: jest.fn().mockResolvedValue({
        valid: true,
        token: { userId: 'u1' },
      }),
      markTokenAsUsed: jest.fn(),
      revokeAllUserTokens: jest.fn(),
      checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
    };
    mail = { sendTeacherInvitationEmail: jest.fn() };
    subscriptions = { grantPlan: jest.fn().mockResolvedValue({}) };
    service = new TeacherInvitationService(
      prisma as unknown as PrismaService,
      tokens as unknown as UserTokenService,
      mail as unknown as MailService,
      { get: () => 'https://opusatlas.com.br' } as unknown as ConfigService,
      { invalidateMany: jest.fn() } as unknown as AppCacheService,
      subscriptions as unknown as SubscriptionsService,
    );
  });

  it('envia os dois links para as páginas do front', async () => {
    prisma.user.findUnique.mockResolvedValue({
      email: 'ana@example.com',
      firstName: 'Ana',
      lastName: null,
    });

    await service.send('u1');

    expect(mail.sendTeacherInvitationEmail).toHaveBeenCalledWith(
      'ana@example.com',
      expect.objectContaining({
        acceptUrl: 'https://opusatlas.com.br/confirm-teacher-invite/tok',
        declineUrl: 'https://opusatlas.com.br/decline-teacher-invite/tok',
      }),
    );
  });

  // Aceitar não é ser aprovado: o selo continua com o admin.
  it('aceitar ativa o perfil, sem verificar', async () => {
    await service.accept('tok');

    expect(prisma.teacher.update).toHaveBeenCalledWith({
      where: { id: 'teacher-1' },
      data: { status: 'ACTIVE' },
    });
    expect(tokens.revokeAllUserTokens).toHaveBeenCalledWith(
      'u1',
      TokenType.TEACHER_INVITATION_DECLINE,
    );
  });

  it('link antigo não reativa perfil que o admin desativou', async () => {
    prisma.user.findUnique.mockResolvedValue(invited('INACTIVE'));

    await service.accept('tok');

    expect(prisma.teacher.update).not.toHaveBeenCalled();
  });

  it('recusar desfaz a promoção', async () => {
    await service.decline('tok');

    expect(prisma.$transaction).toHaveBeenCalledWith([
      'user-update',
      'teacher-update',
    ]);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { isTeacher: false },
    });
  });

  it('convite expirado é 400 com a saída indicada', async () => {
    tokens.validateToken.mockResolvedValue({ valid: false, expired: true });

    await expect(service.accept('tok')).rejects.toThrow(/Peça um novo/);
  });

  it('convite de promoção desfeita não vale', async () => {
    prisma.user.findUnique.mockResolvedValue({
      isTeacher: false,
      teacherProfile: null,
    });

    await expect(service.accept('tok')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('reenvio tem limite por hora', async () => {
    prisma.userToken.findUnique.mockResolvedValue({
      userId: 'u1',
      type: TokenType.TEACHER_INVITATION_ACCEPT,
    });
    tokens.checkRateLimit.mockResolvedValue({ allowed: false });

    await expect(service.resend('tok')).rejects.toBeInstanceOf(HttpException);
  });

  describe('convite pendente, pelo painel', () => {
    const DAY = 86_400_000;
    const pendente = (over: Record<string, unknown> = {}) => ({
      createdAt: new Date(Date.now() - DAY),
      expiresAt: new Date(Date.now() + 29 * DAY),
      metadata: { planGrant: { planType: 'MENTOR', expiresAt: null } },
      ...over,
    });

    it('mostra plano, vencimentos e se já venceu', async () => {
      prisma.userToken.findFirst.mockResolvedValue(
        pendente({ expiresAt: new Date(Date.now() - 1000) }),
      );

      const convite = await service.getPending('u1');

      expect(convite).toMatchObject({
        planType: 'MENTOR',
        planExpiresAt: null,
        expired: true,
      });
    });

    it('sem convite pendente, editar é 404', async () => {
      await expect(
        service.updatePending('u1', 'admin', { planType: 'MAESTRO' }),
      ).rejects.toThrow('Nenhum convite de professor pendente');
    });

    it('troca o plano e prorroga o convite no mesmo link, sem novo e-mail', async () => {
      prisma.userToken.findFirst.mockResolvedValue(pendente());
      const ate = new Date(Date.now() + 10 * DAY);

      await service.updatePending('u1', 'admin', {
        planType: 'MAESTRO',
        inviteExpiresAt: ate,
      });

      expect(prisma.userToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', used: false, type: 'TEACHER_INVITATION_ACCEPT' },
        data: {
          expiresAt: ate,
          metadata: { planGrant: { planType: 'MAESTRO', expiresAt: null } },
        },
      });
      expect(prisma.userToken.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'u1',
          used: false,
          type: 'TEACHER_INVITATION_DECLINE',
        },
        data: { expiresAt: ate },
      });
      expect(mail.sendTeacherInvitationEmail).not.toHaveBeenCalled();
    });

    it('com reenvio, saem links novos com a validade escolhida', async () => {
      prisma.userToken.findFirst.mockResolvedValue(pendente());
      prisma.user.findUnique.mockResolvedValue({
        email: 'ana@example.com',
        firstName: 'Ana',
        lastName: null,
      });
      const ate = new Date(Date.now() + 10 * DAY);

      await service.updatePending('u1', 'admin', {
        inviteExpiresAt: ate,
        resend: true,
      });

      expect(tokens.createToken).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TEACHER_INVITATION_ACCEPT',
          expiresAt: ate,
        }),
      );
      expect(prisma.userToken.updateMany).not.toHaveBeenCalled();
    });

    it('datas no passado são recusadas', async () => {
      prisma.userToken.findFirst.mockResolvedValue(pendente());

      await expect(
        service.updatePending('u1', 'admin', {
          planExpiresAt: new Date(Date.now() - DAY),
        }),
      ).rejects.toThrow('O vencimento do plano precisa ser futuro');
      await expect(
        service.updatePending('u1', 'admin', {
          inviteExpiresAt: new Date(Date.now() - DAY),
        }),
      ).rejects.toThrow('A validade do convite precisa ser futura');
    });

    it('convite antigo, sem plano, exige que se escolha um', async () => {
      prisma.userToken.findFirst.mockResolvedValue(pendente({ metadata: {} }));

      await expect(
        service.updatePending('u1', 'admin', {
          inviteExpiresAt: new Date(Date.now() + DAY),
        }),
      ).rejects.toThrow('Escolha o plano do professor convidado');
    });
  });

  describe('plano que acompanha o convite', () => {
    it('guarda o plano no link de aceite e o cita no e-mail', async () => {
      prisma.user.findUnique.mockResolvedValue({
        email: 'ana@example.com',
        firstName: 'Ana',
        lastName: null,
      });
      const ate = new Date('2027-01-31T12:00:00Z');

      await service.send('u1', undefined, {
        planType: 'MENTOR',
        expiresAt: ate,
      });

      expect(tokens.createToken).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TEACHER_INVITATION_ACCEPT',
          metadata: {
            planGrant: { planType: 'MENTOR', expiresAt: ate.toISOString() },
          },
        }),
      );
      expect(mail.sendTeacherInvitationEmail).toHaveBeenCalledWith(
        'ana@example.com',
        expect.objectContaining({
          planGrant: { planName: 'Mentor', until: '31/01/2027' },
        }),
      );
    });

    it('concede o plano quando o convite é aceito', async () => {
      tokens.validateToken.mockResolvedValue({
        valid: true,
        token: {
          userId: 'u1',
          metadata: { planGrant: { planType: 'MAESTRO', expiresAt: null } },
        },
      });

      await service.accept('tok');

      expect(subscriptions.grantPlan).toHaveBeenCalledWith(
        'u1',
        'MAESTRO',
        null,
      );
    });

    it('sem plano no convite, nada é concedido', async () => {
      await service.accept('tok');
      expect(subscriptions.grantPlan).not.toHaveBeenCalled();
    });
  });
});
