import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserTokenService } from '../auth/user-token.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { NewsletterController } from './newsletter.controller';
import { NewsletterService } from './newsletter.service';

const subscriber = (overrides: Record<string, unknown> = {}) => ({
  id: 'sub-1',
  email: 'ana@x.com',
  firstName: 'Ana',
  userId: null,
  status: 'PENDING',
  ...overrides,
});

describe('NewsletterService', () => {
  let prisma: {
    newsletterSubscriber: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    newsletterEmailEvent: { create: jest.Mock };
    user: { findUnique: jest.Mock };
  };
  let tokens: {
    createToken: jest.Mock;
    validateToken: jest.Mock;
    markTokenAsUsed: jest.Mock;
    checkRateLimit: jest.Mock;
  };
  let mail: {
    sendNewsletterConfirmationEmail: jest.Mock;
    sendNewsletterWelcomeEmail: jest.Mock;
    sendNewsletterUnsubscribeConfirmationEmail: jest.Mock;
  };
  let service: NewsletterService;

  beforeEach(() => {
    prisma = {
      newsletterSubscriber: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      newsletterEmailEvent: { create: jest.fn().mockResolvedValue({}) },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    let counter = 0;
    tokens = {
      createToken: jest.fn(() => Promise.resolve(`tok${++counter}`)),
      validateToken: jest.fn(),
      markTokenAsUsed: jest.fn().mockResolvedValue(undefined),
      checkRateLimit: jest
        .fn()
        .mockResolvedValue({ allowed: true, remainingAttempts: 3 }),
    };
    mail = {
      sendNewsletterConfirmationEmail: jest.fn().mockResolvedValue(undefined),
      sendNewsletterWelcomeEmail: jest.fn().mockResolvedValue(undefined),
      sendNewsletterUnsubscribeConfirmationEmail: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    service = new NewsletterService(
      prisma as unknown as PrismaService,
      tokens as unknown as UserTokenService,
      mail as unknown as MailService,
      {
        get: jest.fn((_k: string, fallback: string) => fallback),
      } as unknown as ConfigService,
    );
  });

  describe('inscrever', () => {
    it('novo e-mail: pendente, com links de confirmar e sair', async () => {
      const result = await service.subscribe({
        email: ' Ana@X.com ',
        firstName: 'Ana',
        interests: ['piano'],
      } as never);

      expect(prisma.newsletterSubscriber.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'ana@x.com',
          status: 'PENDING',
          preferences: { interests: ['piano'] },
          frequency: 'weekly',
        }),
      });
      expect(mail.sendNewsletterConfirmationEmail).toHaveBeenCalledWith(
        'ana@x.com',
        {
          firstName: 'Ana',
          confirmationUrl: 'http://localhost:3000/newsletter/confirm/tok1',
          unsubscribeUrl: 'http://localhost:3000/newsletter/unsubscribe/tok2',
        },
      );
      expect(result).toMatchObject({ success: true, status: 'PENDING' });
    });

    it('e-mail de conta existente usa o nome e o id da conta', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        firstName: 'Beto',
        lastName: 'Silva',
      });

      await service.subscribe({ email: 'beto@x.com' } as never);

      expect(
        prisma.newsletterSubscriber.create.mock.calls[0][0].data,
      ).toMatchObject({
        firstName: 'Beto',
        lastName: 'Silva',
        userId: 'u1',
        preferences: null,
      });
      expect(tokens.createToken).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', anonymousEmail: undefined }),
      );
    });

    it.each([
      ['ACTIVE', 'já está inscrito'],
      ['PENDING', 'ainda não foi confirmado'],
      ['BOUNCED', 'problemas de entrega'],
      ['BLOCKED', 'foi bloqueado'],
    ])('e-mail %s não reinscreve', async (status, message) => {
      prisma.newsletterSubscriber.findUnique.mockResolvedValue(
        subscriber({ status }),
      );

      const result = await service.subscribe({ email: 'ana@x.com' } as never);

      expect(result).toMatchObject({ success: false, status });
      expect(result.message).toContain(message);
      expect(prisma.newsletterSubscriber.create).not.toHaveBeenCalled();
    });

    it('quem saiu volta como pendente', async () => {
      prisma.newsletterSubscriber.findUnique.mockResolvedValue(
        subscriber({ status: 'UNSUBSCRIBED' }),
      );

      const result = await service.subscribe({
        email: 'ana@x.com',
        firstName: 'Ana',
      } as never);

      expect(prisma.newsletterSubscriber.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: expect.objectContaining({
          status: 'PENDING',
          unsubscribedAt: null,
        }),
      });
      expect(result.status).toBe('RESUBSCRIBED');
    });
  });

  describe('reenviar confirmação', () => {
    it('reenvia dentro do limite', async () => {
      prisma.newsletterSubscriber.findUnique.mockResolvedValue(subscriber());

      await expect(
        service.resendConfirmation('ANA@x.com'),
      ).resolves.toMatchObject({
        success: true,
        remainingAttempts: 2,
      });
      expect(tokens.checkRateLimit).toHaveBeenCalledWith(
        { anonymousEmail: 'ana@x.com' },
        'NEWSLETTER_CONFIRMATION',
        3,
      );
    });

    it('conta logada conta pelo usuário; limite estourado recusa', async () => {
      prisma.newsletterSubscriber.findUnique.mockResolvedValue(
        subscriber({ userId: 'u1' }),
      );
      tokens.checkRateLimit.mockResolvedValue({
        allowed: false,
        remainingAttempts: 0,
      });

      await expect(
        service.resendConfirmation('ana@x.com'),
      ).resolves.toMatchObject({
        success: false,
        remainingAttempts: 0,
      });
      expect(tokens.checkRateLimit.mock.calls[0][0]).toEqual({ userId: 'u1' });
    });

    it('não pendente não reenvia; inexistente é 404', async () => {
      prisma.newsletterSubscriber.findUnique.mockResolvedValue(
        subscriber({ status: 'ACTIVE' }),
      );
      await expect(
        service.resendConfirmation('ana@x.com'),
      ).resolves.toMatchObject({ success: false });

      prisma.newsletterSubscriber.findUnique.mockResolvedValue(null);
      await expect(
        service.resendConfirmation('x@x.com'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('confirmar', () => {
    it.each([
      [{ valid: false, expired: true }, 'Token expirado'],
      [{ valid: false, used: true }, 'já foi utilizado'],
      [{ valid: false }, 'Token inválido'],
    ])('token ruim: %p', async (validation, message) => {
      tokens.validateToken.mockResolvedValue(validation);

      const result = await service.confirm('t');
      expect(result.success).toBe(false);
      expect(result.message).toContain(message);
    });

    it('confirma, registra o evento e dá boas-vindas com link de saída', async () => {
      tokens.validateToken.mockResolvedValue({
        valid: true,
        token: { userId: null, anonymousEmail: 'ana@x.com' },
      });
      prisma.newsletterSubscriber.findUnique.mockResolvedValue(subscriber());

      const result = await service.confirm('t');

      expect(tokens.markTokenAsUsed).toHaveBeenCalledWith('t');
      expect(prisma.newsletterSubscriber.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'ACTIVE', confirmedAt: expect.any(Date) },
      });
      expect(mail.sendNewsletterWelcomeEmail).toHaveBeenCalledWith(
        'ana@x.com',
        {
          firstName: 'Ana',
          unsubscribeUrl: expect.stringContaining('/newsletter/unsubscribe/'),
        },
      );
      expect(result.status).toBe('ACTIVE');
    });

    it('já ativo não confirma de novo; token de conta procura pelo usuário', async () => {
      tokens.validateToken.mockResolvedValue({
        valid: true,
        token: { userId: 'u1', anonymousEmail: null },
      });
      prisma.newsletterSubscriber.findFirst.mockResolvedValue(
        subscriber({ status: 'ACTIVE', userId: 'u1' }),
      );

      await expect(service.confirm('t')).resolves.toMatchObject({
        success: true,
        status: 'ACTIVE',
      });
      expect(prisma.newsletterSubscriber.findFirst).toHaveBeenCalledWith({
        where: { userId: 'u1' },
      });
      expect(prisma.newsletterSubscriber.update).not.toHaveBeenCalled();
    });

    it('token sem dono é 404', async () => {
      tokens.validateToken.mockResolvedValue({
        valid: true,
        token: { userId: null, anonymousEmail: null },
      });

      await expect(service.confirm('t')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('sair', () => {
    it('pelo token: sai, registra motivo e oferece voltar', async () => {
      tokens.validateToken.mockResolvedValue({
        valid: true,
        token: { userId: null, anonymousEmail: 'ana@x.com' },
      });
      prisma.newsletterSubscriber.findUnique.mockResolvedValue(
        subscriber({ status: 'ACTIVE', firstName: null }),
      );

      const result = await service.unsubscribe({
        token: 't',
        reason: 'too_many',
        feedback: 'x',
      } as never);

      expect(prisma.newsletterSubscriber.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: expect.objectContaining({
          status: 'UNSUBSCRIBED',
          unsubscribeReason: 'too_many',
        }),
      });
      expect(
        mail.sendNewsletterUnsubscribeConfirmationEmail,
      ).toHaveBeenCalledWith('ana@x.com', {
        firstName: 'Usuário',
        resubscribeUrl:
          'http://localhost:3000/newsletter/resubscribe?email=ana%40x.com',
      });
      expect(result.status).toBe('UNSUBSCRIBED');
    });

    it.each([
      [{ valid: false, expired: true }, 'Token expirado.'],
      [{ valid: false, used: true }, 'Token já foi utilizado.'],
      [{ valid: false }, 'Token inválido.'],
    ])('token ruim na saída: %p', async (validation, message) => {
      tokens.validateToken.mockResolvedValue(validation);

      await expect(
        service.unsubscribe({ token: 't' } as never),
      ).resolves.toEqual({ success: false, message });
    });

    it('pelo e-mail; já saiu; inexistente', async () => {
      prisma.newsletterSubscriber.findUnique.mockResolvedValue(
        subscriber({ status: 'UNSUBSCRIBED' }),
      );
      await expect(
        service.unsubscribe({ email: 'ANA@x.com' } as never),
      ).resolves.toMatchObject({
        success: false,
        status: 'UNSUBSCRIBED',
      });

      prisma.newsletterSubscriber.findUnique.mockResolvedValue(null);
      await expect(
        service.unsubscribe({ email: 'x@x.com' } as never),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.unsubscribe({} as never)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('voltar', () => {
    it('ativo e pendente não voltam; inexistente é 404', async () => {
      prisma.newsletterSubscriber.findUnique.mockResolvedValue(
        subscriber({ status: 'ACTIVE' }),
      );
      await expect(service.resubscribe('ana@x.com')).resolves.toMatchObject({
        status: 'ACTIVE',
      });

      prisma.newsletterSubscriber.findUnique.mockResolvedValue(subscriber());
      await expect(service.resubscribe('ana@x.com')).resolves.toMatchObject({
        status: 'PENDING',
      });

      prisma.newsletterSubscriber.findUnique.mockResolvedValue(null);
      await expect(service.resubscribe('x@x.com')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('quem saiu volta como pendente, com nova confirmação', async () => {
      prisma.newsletterSubscriber.findUnique.mockResolvedValue(
        subscriber({ status: 'UNSUBSCRIBED', firstName: null }),
      );

      await expect(service.resubscribe('ana@x.com')).resolves.toMatchObject({
        status: 'RESUBSCRIBED',
      });
      expect(mail.sendNewsletterConfirmationEmail).toHaveBeenCalledWith(
        'ana@x.com',
        expect.objectContaining({ firstName: 'Usuário' }),
      );
    });
  });
});

describe('NewsletterController', () => {
  it('repassa cada rota ao serviço', async () => {
    const service = {
      subscribe: jest.fn().mockResolvedValue('subscribe'),
      resendConfirmation: jest.fn().mockResolvedValue('resend'),
      confirm: jest.fn().mockResolvedValue('confirm'),
      unsubscribe: jest.fn().mockResolvedValue('unsubscribe'),
      resubscribe: jest.fn().mockResolvedValue('resubscribe'),
    };
    const controller = new NewsletterController(
      service as unknown as NewsletterService,
    );

    await expect(
      controller.subscribe({ email: 'a@x.com' } as never),
    ).resolves.toBe('subscribe');
    await expect(
      controller.resendConfirmation({ email: 'a@x.com' }),
    ).resolves.toBe('resend');
    await expect(controller.confirm('t')).resolves.toBe('confirm');
    await expect(controller.unsubscribe({ token: 't' } as never)).resolves.toBe(
      'unsubscribe',
    );
    await expect(controller.resubscribe({ email: 'a@x.com' })).resolves.toBe(
      'resubscribe',
    );
    expect(service.resendConfirmation).toHaveBeenCalledWith('a@x.com');
    expect(service.resubscribe).toHaveBeenCalledWith('a@x.com');
  });
});
