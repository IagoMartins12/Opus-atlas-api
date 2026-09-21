// `@nestjs/jwt@12` é ESM puro e o ts-jest não o lê.
jest.mock('@nestjs/jwt', () => ({ JwtService: class JwtService {} }));

import { UnauthorizedException } from '@nestjs/common';
import { Prisma, TokenType } from '@prisma/client';
import { AuthService } from './auth.service';
import { GoogleProfile } from './interfaces/google-profile.interface';

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: '6.19.0',
  });

const authUser = {
  id: 'u1',
  email: 'ana@gmail.com',
  firstName: 'Ana',
  lastName: 'Lima',
  role: 0,
  isTeacher: false,
  isStudent: false,
};

const googleProfile = (over: Partial<GoogleProfile> = {}): GoogleProfile => ({
  sub: 'g-1',
  email: 'Ana@Gmail.com',
  emailVerified: true,
  givenName: 'Ana',
  familyName: 'Lima',
  picture: 'https://foto',
  ...over,
});

describe('AuthService — Google e reenvio da confirmação', () => {
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    account: { findUnique: jest.Mock; create: jest.Mock };
    userToken: { create: jest.Mock };
  };
  let mail: {
    sendAccountConfirmationEmail: jest.Mock;
    sendWelcomeEmail: jest.Mock;
  };
  let tokens: { createToken: jest.Mock; checkRateLimit: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(authUser),
        update: jest.fn().mockResolvedValue({}),
      },
      account: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      userToken: { create: jest.fn().mockResolvedValue({}) },
    };
    mail = {
      sendAccountConfirmationEmail: jest.fn().mockResolvedValue(undefined),
      sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
    };
    tokens = {
      createToken: jest.fn().mockResolvedValue('tok'),
      checkRateLimit: jest
        .fn()
        .mockResolvedValue({ allowed: true, remainingAttempts: 2 }),
    };
    const config = {
      get: (key: string, fallback?: unknown) =>
        ({
          'auth.accessSecret': 'acesso',
          'auth.refreshSecret': 'renovacao',
          'auth.accessExpiresIn': '15m',
          'auth.refreshExpiresIn': '7d',
          'mediaSearch.frontendBaseUrl': 'http://front',
        })[key] ?? fallback,
    };

    service = new AuthService(
      prisma as never,
      { signAsync: jest.fn().mockResolvedValue('token') } as never,
      config as never,
      mail as never,
      tokens as never,
    );
  });

  describe('reenviar a confirmação', () => {
    const ctx = { ipAddress: '1.1.1.1', userAgent: 'UA' };
    const generic = {
      success: true,
      message: expect.stringContaining('ainda não confirmada'),
    };

    // A mesma resposta em todos os casos: não serve de consulta de contas.
    it('e-mail desconhecido ou já confirmado: resposta genérica, nada enviado', async () => {
      await expect(
        service.resendAccountConfirmation({ email: 'x@x.com' }, ctx),
      ).resolves.toEqual(generic);

      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        firstName: 'Ana',
        emailVerified: new Date(),
      });
      await expect(
        service.resendAccountConfirmation({ email: 'ana@x.com' }, ctx),
      ).resolves.toEqual(generic);

      expect(tokens.createToken).not.toHaveBeenCalled();
      expect(mail.sendAccountConfirmationEmail).not.toHaveBeenCalled();
    });

    it('limite estourado: mesma resposta, sem novo link', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        firstName: 'Ana',
        emailVerified: null,
      });
      tokens.checkRateLimit.mockResolvedValue({
        allowed: false,
        remainingAttempts: 0,
      });

      await expect(
        service.resendAccountConfirmation({ email: 'ana@x.com' }, ctx),
      ).resolves.toEqual(generic);
      expect(tokens.createToken).not.toHaveBeenCalled();
    });

    it('conta não confirmada: novo link, com IP e navegador, e o e-mail normalizado', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        firstName: 'Ana',
        emailVerified: null,
      });

      await service.resendAccountConfirmation({ email: ' Ana@X.com ' }, ctx);

      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'ana@x.com' } }),
      );
      expect(tokens.checkRateLimit).toHaveBeenCalledWith(
        { userId: 'u1' },
        TokenType.EMAIL_CONFIRMATION,
        3,
      );
      expect(tokens.createToken).toHaveBeenCalledWith({
        userId: 'u1',
        type: TokenType.EMAIL_CONFIRMATION,
        ipAddress: '1.1.1.1',
        userAgent: 'UA',
      });
      expect(mail.sendAccountConfirmationEmail).toHaveBeenCalledWith(
        'ana@x.com',
        {
          firstName: 'Ana',
          confirmationUrl: 'http://front/confirm-account/tok',
        },
      );
    });
  });

  describe('reenviar pelo link da confirmação', () => {
    const ctx = { ipAddress: '1.1.1.1', userAgent: 'UA' };
    const withTokens = (validateToken: jest.Mock) =>
      Object.assign(tokens as unknown as Record<string, jest.Mock>, {
        validateToken,
      });

    // A página do link vencido não conhece o e-mail de quem não entrou.
    it('link vencido: novo link para o e-mail da conta dona dele', async () => {
      withTokens(
        jest.fn().mockResolvedValue({
          valid: false,
          expired: true,
          token: { userId: 'u1' },
        }),
      );
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'ana@x.com',
        firstName: 'Ana',
        emailVerified: null,
      });

      await service.resendAccountConfirmation({ token: 'link-antigo' }, ctx);

      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u1' } }),
      );
      expect(mail.sendAccountConfirmationEmail).toHaveBeenCalledWith(
        'ana@x.com',
        expect.objectContaining({
          confirmationUrl: 'http://front/confirm-account/tok',
        }),
      );
    });

    it('token desconhecido: resposta genérica, nada enviado', async () => {
      withTokens(jest.fn().mockResolvedValue({ valid: false }));

      await expect(
        service.resendAccountConfirmation({ token: 'nao-existe' }, ctx),
      ).resolves.toMatchObject({ success: true });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(mail.sendAccountConfirmationEmail).not.toHaveBeenCalled();
    });
  });

  describe('entrar com o Google', () => {
    it('e-mail que o Google não confirmou é recusado antes de qualquer consulta', async () => {
      await expect(
        service.loginWithGoogle(googleProfile({ emailVerified: false })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.account.findUnique).not.toHaveBeenCalled();
    });

    // Mesma chave que o adaptador do NextAuth gravava.
    it('conta já vinculada entra direto', async () => {
      prisma.account.findUnique.mockResolvedValue({ user: authUser });

      const result = await service.loginWithGoogle(googleProfile());

      expect(prisma.account.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            provider_providerAccountId: {
              provider: 'google',
              providerAccountId: 'g-1',
            },
          },
        }),
      );
      expect(result.isNewUser).toBe(false);
      expect(result.session.user.id).toBe('u1');
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.account.create).not.toHaveBeenCalled();
    });

    it('e-mail já cadastrado por senha: vincula, confirma o e-mail e usa a foto do Google', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...authUser,
        emailVerified: null,
        image: null,
      });

      const result = await service.loginWithGoogle(googleProfile());

      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'ana@gmail.com' } }),
      );
      expect(prisma.account.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          type: 'oauth',
          provider: 'google',
          providerAccountId: 'g-1',
        },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { emailVerified: expect.any(Date), image: 'https://foto' },
      });
      expect(result.isNewUser).toBe(false);
    });

    it('conta já confirmada e com foto: vincula sem mexer nos dados', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...authUser,
        emailVerified: new Date(),
        image: 'minha-foto',
      });

      await service.loginWithGoogle(googleProfile());

      expect(prisma.user.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ image: 'https://foto' }),
        }),
      );
    });

    it('vínculo criado ao mesmo tempo por outra aba não é erro; outro erro sobe', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...authUser,
        emailVerified: new Date(),
        image: 'x',
      });
      prisma.account.create.mockRejectedValueOnce(p2002());

      await expect(
        service.loginWithGoogle(googleProfile()),
      ).resolves.toMatchObject({ isNewUser: false });

      prisma.account.create.mockRejectedValueOnce(new Error('banco fora'));
      await expect(service.loginWithGoogle(googleProfile())).rejects.toThrow(
        'banco fora',
      );
    });

    it('conta nova: nasce confirmada, vinculada e sem senha, e recebe boas-vindas', async () => {
      const result = await service.loginWithGoogle(googleProfile());

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            email: 'ana@gmail.com',
            username: 'ana',
            firstName: 'Ana',
            lastName: 'Lima',
            image: 'https://foto',
            emailVerified: expect.any(Date),
            accounts: {
              create: {
                type: 'oauth',
                provider: 'google',
                providerAccountId: 'g-1',
              },
            },
          },
        }),
      );
      expect(mail.sendWelcomeEmail).toHaveBeenCalledWith('ana@gmail.com', {
        firstName: 'Ana',
        onboardingUrl: 'http://front/?onboarding=true',
      });
      expect(result.isNewUser).toBe(true);
      expect(result.session.accessToken).toBe('token');
    });

    it('boas-vindas que falham não impedem a entrada', async () => {
      mail.sendWelcomeEmail.mockRejectedValue(new Error('smtp'));

      await expect(
        service.loginWithGoogle(googleProfile({ givenName: null })),
      ).resolves.toMatchObject({ isNewUser: true });
    });

    it('duas abas no primeiro login: a segunda vincula a conta que a outra criou', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // por e-mail
        .mockResolvedValueOnce(null) // nome de usuário livre
        .mockResolvedValueOnce(authUser); // relida depois da corrida
      prisma.user.create.mockRejectedValue(p2002());

      const result = await service.loginWithGoogle(googleProfile());

      expect(prisma.account.create).toHaveBeenCalled();
      expect(result.session.user.id).toBe('u1');
      expect(mail.sendWelcomeEmail).not.toHaveBeenCalled();
    });

    it('violação de unicidade que não é da conta criada ao lado sobe', async () => {
      prisma.user.create.mockRejectedValue(p2002());

      await expect(
        service.loginWithGoogle(googleProfile()),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });
  });
});
