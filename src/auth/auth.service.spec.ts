import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TokenType } from '@prisma/client';
import * as argon2 from 'argon2';
import * as bcrypt from 'bcryptjs';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { UserTokenService } from './user-token.service';

// `@nestjs/jwt@12` é publicado como ESM puro e quebra o parser CJS do ts-jest
// quando carregado de verdade — mockamos o módulo inteiro para nunca importá-lo.
jest.mock('@nestjs/jwt', () => ({
  JwtService: class JwtService {},
}));
import { JwtService } from '@nestjs/jwt';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    userToken: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let jwtService: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  let mailService: Record<string, jest.Mock>;
  let userTokenService: Record<string, jest.Mock>;

  const baseUser = {
    id: 'user-1',
    email: 'aluno@opusatlas.com',
    firstName: 'Maria',
    lastName: 'Silva',
    role: 0,
    isTeacher: false,
    isStudent: false,
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      userToken: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    jwtService = {
      signAsync: jest
        .fn()
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token'),
      verifyAsync: jest.fn(),
    };

    mailService = {
      sendAccountConfirmationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
      sendGoogleAccountResetNotice: jest.fn().mockResolvedValue(undefined),
      sendPasswordChangedEmail: jest.fn().mockResolvedValue(undefined),
      sendEmailChangedToOldAddress: jest.fn().mockResolvedValue(undefined),
      sendEmailChangeConfirmedToNewAddress: jest
        .fn()
        .mockResolvedValue(undefined),
    };

    userTokenService = {
      createToken: jest.fn().mockResolvedValue('plain-token'),
      validateToken: jest.fn(),
      markTokenAsUsed: jest.fn().mockResolvedValue(undefined),
      revokeAllUserTokens: jest.fn().mockResolvedValue(undefined),
      checkRateLimit: jest
        .fn()
        .mockResolvedValue({ allowed: true, remainingAttempts: 4 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: MailService, useValue: mailService },
        { provide: UserTokenService, useValue: userTokenService },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: unknown) =>
              ({
                'auth.accessSecret': 'access-secret',
                'auth.refreshSecret': 'refresh-secret',
                'auth.accessExpiresIn': '15m',
                'auth.refreshExpiresIn': '7d',
                'mediaSearch.frontendBaseUrl': 'http://localhost:3000',
              })[key] ?? fallback,
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('register', () => {
    it('rejeita e-mail já cadastrado', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.register({
          email: baseUser.email,
          password: 'SenhaForte123!',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('cria usuário com hash argon2, dispara e-mail de confirmação e emite sessão', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(baseUser);
      prisma.userToken.create.mockResolvedValue({});

      const result = await service.register({
        email: baseUser.email,
        password: 'SenhaForte123!',
      });

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.user.id).toBe(baseUser.id);

      const createArgs = prisma.user.create.mock.calls[0][0];
      expect(
        await argon2.verify(createArgs.data.hashedPassword, 'SenhaForte123!'),
      ).toBe(true);

      expect(userTokenService.createToken).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: baseUser.id,
          type: TokenType.EMAIL_CONFIRMATION,
        }),
      );
      expect(mailService.sendAccountConfirmationEmail).toHaveBeenCalledWith(
        baseUser.email,
        expect.objectContaining({
          confirmationUrl: 'http://localhost:3000/confirm-account/plain-token',
        }),
      );

      expect(prisma.userToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: baseUser.id,
            type: TokenType.REFRESH_TOKEN,
          }),
        }),
      );
    });

    it('não falha o registro se o envio do e-mail de confirmação der erro', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(baseUser);
      prisma.userToken.create.mockResolvedValue({});
      userTokenService.createToken.mockRejectedValueOnce(
        new Error('smtp down'),
      );

      await expect(
        service.register({ email: baseUser.email, password: 'SenhaForte123!' }),
      ).resolves.toMatchObject({ accessToken: 'access-token' });
    });
  });

  describe('login', () => {
    it('rejeita senha incorreta', async () => {
      const hashedPassword = await argon2.hash('SenhaCorreta123!');
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, hashedPassword });

      await expect(
        service.login({ email: baseUser.email, password: 'errada' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('autentica com hash argon2 existente', async () => {
      const hashedPassword = await argon2.hash('SenhaForte123!');
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, hashedPassword });
      prisma.userToken.create.mockResolvedValue({});

      const result = await service.login({
        email: baseUser.email,
        password: 'SenhaForte123!',
      });

      expect(result.accessToken).toBe('access-token');
      // Hash já em argon2 não é regravado — a única escrita é o último acesso.
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: baseUser.id },
        data: { lastSeen: expect.any(Date) },
      });
    });

    it('autentica com hash bcrypt legado e reescreve para argon2 (rehash transparente)', async () => {
      const legacyHash = await bcrypt.hash('SenhaForte123!', 10);
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        hashedPassword: legacyHash,
      });
      prisma.userToken.create.mockResolvedValue({});
      prisma.user.update.mockResolvedValue({});

      await service.login({
        email: baseUser.email,
        password: 'SenhaForte123!',
      });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: baseUser.id } }),
      );
      const rehashed = prisma.user.update.mock.calls[0][0].data.hashedPassword;
      expect(rehashed.startsWith('$2')).toBe(false);
      expect(await argon2.verify(rehashed, 'SenhaForte123!')).toBe(true);
    });
  });

  describe('refresh', () => {
    it('rejeita quando o token já foi usado (proteção contra reuso)', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: baseUser.id,
        type: 'refresh',
      });
      prisma.userToken.findFirst.mockResolvedValue({
        id: 'token-1',
        used: true,
        expiresAt: new Date(Date.now() + 1000),
      });

      await expect(
        service.refresh({ refreshToken: 'refresh-token' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rotaciona o token: marca o antigo como usado e emite um novo par', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: baseUser.id,
        type: 'refresh',
      });
      prisma.userToken.findFirst.mockResolvedValue({
        id: 'token-1',
        used: false,
        expiresAt: new Date(Date.now() + 1000),
      });
      prisma.userToken.update.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue(baseUser);
      prisma.userToken.create.mockResolvedValue({});

      const result = await service.refresh({ refreshToken: 'refresh-token' });

      expect(prisma.userToken.update).toHaveBeenCalledWith({
        where: { id: 'token-1' },
        data: { used: true },
      });
      expect(result.accessToken).toBe('access-token');
    });
  });

  describe('logout', () => {
    it('revoga o refresh token ativo do usuário', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: baseUser.id,
        type: 'refresh',
      });
      prisma.userToken.updateMany.mockResolvedValue({ count: 1 });

      await service.logout({ refreshToken: 'refresh-token' });

      expect(prisma.userToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: baseUser.id,
            type: TokenType.REFRESH_TOKEN,
            used: false,
          }),
          data: { used: true },
        }),
      );
    });

    it('é idempotente para token já inválido/expirado', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('expired'));

      await expect(
        service.logout({ refreshToken: 'invalid' }),
      ).resolves.toBeUndefined();
      expect(prisma.userToken.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    const ctx = { ipAddress: '203.0.113.10', userAgent: 'jest' };

    it('retorna mensagem genérica quando o e-mail não existe (anti-enumeração)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.forgotPassword(
        { email: 'ninguem@opusatlas.com' },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(userTokenService.createToken).not.toHaveBeenCalled();
    }, 10000);

    it('envia aviso especial para conta Google (sem senha própria)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: baseUser.id,
        email: baseUser.email,
        firstName: baseUser.firstName,
        hashedPassword: null,
      });

      const result = await service.forgotPassword(
        { email: baseUser.email },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(mailService.sendGoogleAccountResetNotice).toHaveBeenCalled();
      expect(userTokenService.createToken).not.toHaveBeenCalled();
    });

    it('lança 429 quando o rate limit foi excedido', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: baseUser.id,
        email: baseUser.email,
        firstName: baseUser.firstName,
        hashedPassword: 'argon2-hash',
      });
      userTokenService.checkRateLimit.mockResolvedValue({
        allowed: false,
        remainingAttempts: 0,
      });

      await expect(
        service.forgotPassword({ email: baseUser.email }, ctx),
      ).rejects.toBeInstanceOf(HttpException);
    });

    it('cria token de reset e envia e-mail quando tudo está OK', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: baseUser.id,
        email: baseUser.email,
        firstName: baseUser.firstName,
        hashedPassword: 'argon2-hash',
      });

      const result = await service.forgotPassword(
        { email: baseUser.email },
        ctx,
      );

      expect(userTokenService.createToken).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: baseUser.id,
          type: TokenType.PASSWORD_RESET,
        }),
      );
      expect(mailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        baseUser.email,
        expect.objectContaining({
          resetUrl: 'http://localhost:3000/reset-password/plain-token',
        }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe('resetPassword', () => {
    const ctx = { ipAddress: '203.0.113.10' };

    it('rejeita quando as senhas não coincidem', async () => {
      await expect(
        service.resetPassword(
          {
            token: 't',
            password: 'SenhaForte123!',
            confirmPassword: 'Outra123!',
          },
          ctx,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita senha fraca', async () => {
      await expect(
        service.resetPassword(
          { token: 't', password: 'fraca', confirmPassword: 'fraca' },
          ctx,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita token inválido/expirado', async () => {
      userTokenService.validateToken.mockResolvedValue({
        valid: false,
        expired: true,
      });

      await expect(
        service.resetPassword(
          {
            token: 't',
            password: 'SenhaForte123!',
            confirmPassword: 'SenhaForte123!',
          },
          ctx,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita conta vinculada ao Google (sem hashedPassword)', async () => {
      userTokenService.validateToken.mockResolvedValue({
        valid: true,
        token: { userId: baseUser.id },
      });
      prisma.user.findUnique.mockResolvedValue({
        id: baseUser.id,
        email: baseUser.email,
        firstName: baseUser.firstName,
        hashedPassword: null,
      });

      await expect(
        service.resetPassword(
          {
            token: 't',
            password: 'SenhaForte123!',
            confirmPassword: 'SenhaForte123!',
          },
          ctx,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita quando a nova senha é igual à atual', async () => {
      const hashedPassword = await argon2.hash('SenhaForte123!');
      userTokenService.validateToken.mockResolvedValue({
        valid: true,
        token: { userId: baseUser.id },
      });
      prisma.user.findUnique.mockResolvedValue({
        id: baseUser.id,
        email: baseUser.email,
        firstName: baseUser.firstName,
        hashedPassword,
      });

      await expect(
        service.resetPassword(
          {
            token: 't',
            password: 'SenhaForte123!',
            confirmPassword: 'SenhaForte123!',
          },
          ctx,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('redefine a senha, revoga tokens e notifica por e-mail', async () => {
      const hashedPassword = await argon2.hash('SenhaAntiga123!');
      userTokenService.validateToken.mockResolvedValue({
        valid: true,
        token: { userId: baseUser.id },
      });
      prisma.user.findUnique.mockResolvedValue({
        id: baseUser.id,
        email: baseUser.email,
        firstName: baseUser.firstName,
        hashedPassword,
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.resetPassword(
        {
          token: 't',
          password: 'SenhaNova123!',
          confirmPassword: 'SenhaNova123!',
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(userTokenService.markTokenAsUsed).toHaveBeenCalledWith('t');
      expect(userTokenService.revokeAllUserTokens).toHaveBeenCalledWith(
        baseUser.id,
        TokenType.PASSWORD_RESET,
      );
      expect(userTokenService.revokeAllUserTokens).toHaveBeenCalledWith(
        baseUser.id,
        TokenType.REFRESH_TOKEN,
      );
      expect(mailService.sendPasswordChangedEmail).toHaveBeenCalled();
    });
  });

  describe('confirmAccount', () => {
    it('rejeita token inválido', async () => {
      userTokenService.validateToken.mockResolvedValue({ valid: false });

      await expect(service.confirmAccount('t')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('sinaliza alreadyConfirmed quando o e-mail já estava confirmado', async () => {
      userTokenService.validateToken.mockResolvedValue({
        valid: true,
        token: { userId: baseUser.id },
      });
      prisma.user.findUnique.mockResolvedValue({
        id: baseUser.id,
        emailVerified: new Date(),
      });

      const result = await service.confirmAccount('t');

      expect(result.alreadyConfirmed).toBe(true);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(userTokenService.markTokenAsUsed).toHaveBeenCalledWith('t');
    });

    it('confirma o e-mail quando ainda não verificado', async () => {
      userTokenService.validateToken.mockResolvedValue({
        valid: true,
        token: { userId: baseUser.id },
      });
      prisma.user.findUnique.mockResolvedValue({
        id: baseUser.id,
        emailVerified: null,
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.confirmAccount('t');

      expect(result.success).toBe(true);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: baseUser.id },
        data: { emailVerified: expect.any(Date) },
      });
    });
  });

  describe('checkEmailStatus', () => {
    it('retorna exists=false quando o e-mail não está cadastrado', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.checkEmailStatus('ninguem@opusatlas.com');

      expect(result).toEqual({ exists: false, verified: false });
    });

    it('retorna exists=true e verified de acordo com emailVerified', async () => {
      prisma.user.findUnique.mockResolvedValue({ emailVerified: new Date() });

      const result = await service.checkEmailStatus(baseUser.email);

      expect(result).toEqual({ exists: true, verified: true });
    });
  });

  describe('confirmEmailChange', () => {
    it('rejeita quando o novo e-mail já pertence a outra conta', async () => {
      userTokenService.validateToken.mockResolvedValue({
        valid: true,
        token: {
          userId: baseUser.id,
          metadata: { newEmail: 'novo@opusatlas.com' },
          anonymousEmail: null,
        },
      });
      prisma.user.findUnique
        .mockResolvedValueOnce({
          id: baseUser.id,
          email: baseUser.email,
          firstName: baseUser.firstName,
        })
        .mockResolvedValueOnce({ id: 'other-user' });

      await expect(service.confirmEmailChange('t')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('atualiza o e-mail e notifica endereço antigo e novo', async () => {
      userTokenService.validateToken.mockResolvedValue({
        valid: true,
        token: {
          userId: baseUser.id,
          metadata: {
            newEmail: 'novo@opusatlas.com',
            oldEmail: baseUser.email,
          },
          anonymousEmail: null,
        },
      });
      prisma.user.findUnique
        .mockResolvedValueOnce({
          id: baseUser.id,
          email: baseUser.email,
          firstName: baseUser.firstName,
        })
        .mockResolvedValueOnce(null);
      prisma.user.update.mockResolvedValue({});

      const result = await service.confirmEmailChange('t');

      expect(result).toMatchObject({
        success: true,
        oldEmail: baseUser.email,
        newEmail: 'novo@opusatlas.com',
      });
      expect(mailService.sendEmailChangedToOldAddress).toHaveBeenCalled();
      expect(
        mailService.sendEmailChangeConfirmedToNewAddress,
      ).toHaveBeenCalled();
    });

    it('lança NotFoundException quando o usuário do token não existe mais', async () => {
      userTokenService.validateToken.mockResolvedValue({
        valid: true,
        token: {
          userId: baseUser.id,
          metadata: { newEmail: 'novo@opusatlas.com' },
          anonymousEmail: null,
        },
      });
      prisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.confirmEmailChange('t')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
