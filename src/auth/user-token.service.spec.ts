import { Test, TestingModule } from '@nestjs/testing';
import { TokenType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UserTokenService } from './user-token.service';

describe('UserTokenService', () => {
  let service: UserTokenService;
  let prisma: {
    userToken: {
      updateMany: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      userToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserTokenService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(UserTokenService);
  });

  describe('createToken', () => {
    it('invalida tokens anteriores não usados do mesmo tipo/usuário antes de criar um novo', async () => {
      const token = await service.createToken({
        userId: 'user-1',
        type: TokenType.PASSWORD_RESET,
      });

      expect(token).toHaveLength(64);
      expect(prisma.userToken.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          type: TokenType.PASSWORD_RESET,
          used: false,
        },
        data: { used: true },
      });
      expect(prisma.userToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            type: TokenType.PASSWORD_RESET,
            token,
          }),
        }),
      );
    });

    it('usa expiração de 1h para PASSWORD_RESET e 24h para EMAIL_CONFIRMATION', async () => {
      const before = Date.now();

      await service.createToken({
        userId: 'u',
        type: TokenType.PASSWORD_RESET,
      });
      const resetExpiresAt = prisma.userToken.create.mock.calls[0][0].data
        .expiresAt as Date;

      await service.createToken({
        userId: 'u',
        type: TokenType.EMAIL_CONFIRMATION,
      });
      const confirmExpiresAt = prisma.userToken.create.mock.calls[1][0].data
        .expiresAt as Date;

      expect(resetExpiresAt.getTime() - before).toBeLessThan(70 * 60 * 1000);
      expect(confirmExpiresAt.getTime() - before).toBeGreaterThan(
        23 * 60 * 60 * 1000,
      );
    });
  });

  describe('validateToken', () => {
    it('retorna valid=false quando o token não existe', async () => {
      prisma.userToken.findUnique.mockResolvedValue(null);

      const result = await service.validateToken(
        'nope',
        TokenType.PASSWORD_RESET,
      );

      expect(result).toEqual({ valid: false });
    });

    it('retorna valid=false quando o tipo não bate', async () => {
      prisma.userToken.findUnique.mockResolvedValue({
        type: TokenType.EMAIL_CONFIRMATION,
        used: false,
        expiresAt: new Date(Date.now() + 1000),
      });

      const result = await service.validateToken('t', TokenType.PASSWORD_RESET);

      expect(result).toEqual({ valid: false });
    });

    it('sinaliza used quando o token já foi usado', async () => {
      const record = {
        type: TokenType.PASSWORD_RESET,
        used: true,
        expiresAt: new Date(Date.now() + 1000),
      };
      prisma.userToken.findUnique.mockResolvedValue(record);

      const result = await service.validateToken('t', TokenType.PASSWORD_RESET);

      expect(result).toEqual({ valid: false, used: true, token: record });
    });

    it('sinaliza expired quando passou da data de expiração', async () => {
      const record = {
        type: TokenType.PASSWORD_RESET,
        used: false,
        expiresAt: new Date(Date.now() - 1000),
      };
      prisma.userToken.findUnique.mockResolvedValue(record);

      const result = await service.validateToken('t', TokenType.PASSWORD_RESET);

      expect(result).toEqual({ valid: false, expired: true, token: record });
    });

    it('retorna valid=true para um token são', async () => {
      const record = {
        type: TokenType.PASSWORD_RESET,
        used: false,
        expiresAt: new Date(Date.now() + 1000),
      };
      prisma.userToken.findUnique.mockResolvedValue(record);

      const result = await service.validateToken('t', TokenType.PASSWORD_RESET);

      expect(result).toEqual({ valid: true, token: record });
    });
  });

  describe('checkRateLimit', () => {
    it('permite quando a contagem está abaixo do limite', async () => {
      prisma.userToken.count.mockResolvedValue(2);

      const result = await service.checkRateLimit(
        { userId: 'user-1' },
        TokenType.PASSWORD_RESET,
        5,
      );

      expect(result).toEqual({ allowed: true, remainingAttempts: 3 });
    });

    it('bloqueia quando a contagem atinge o limite', async () => {
      prisma.userToken.count.mockResolvedValue(5);

      const result = await service.checkRateLimit(
        { userId: 'user-1' },
        TokenType.PASSWORD_RESET,
        5,
      );

      expect(result).toEqual({ allowed: false, remainingAttempts: 0 });
    });
  });
});
