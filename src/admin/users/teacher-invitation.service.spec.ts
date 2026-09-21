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
    userToken: { findUnique: jest.Mock };
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
      userToken: { findUnique: jest.fn() },
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
    service = new TeacherInvitationService(
      prisma as unknown as PrismaService,
      tokens as unknown as UserTokenService,
      mail as unknown as MailService,
      { get: () => 'https://opusatlas.com.br' } as unknown as ConfigService,
      { invalidateMany: jest.fn() } as unknown as AppCacheService,
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
});
