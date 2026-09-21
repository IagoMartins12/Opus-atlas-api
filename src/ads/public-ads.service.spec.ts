import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppCacheService } from '../common/cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { deviceOf, PublicAdsService } from './public-ads.service';

const AD = '64b0000000000000000000ad';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile';

describe('PublicAdsService', () => {
  let prisma: {
    advertisement: { findMany: jest.Mock; findFirst: jest.Mock };
    adStats: { upsert: jest.Mock; update: jest.Mock };
  };
  let store: Map<string, unknown>;
  let service: PublicAdsService;

  beforeEach(() => {
    store = new Map();
    prisma = {
      advertisement: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: AD }),
      },
      adStats: {
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const cache = {
      get: jest.fn((key: string) => Promise.resolve(store.get(key))),
      set: jest.fn((key: string, value: unknown) => {
        store.set(key, value);
        return Promise.resolve();
      }),
    };
    service = new PublicAdsService(
      prisma as unknown as PrismaService,
      cache as unknown as AppCacheService,
    );
  });

  it('reconhece o dispositivo pelo User-Agent', () => {
    expect(deviceOf(IPHONE)).toBe('mobile');
    expect(deviceOf('Mozilla/5.0 (iPad; CPU OS 17_0)')).toBe('tablet');
    expect(deviceOf(undefined)).toBe('desktop');
  });

  // No legado o filtro vinha depois do take: 1.
  it('o dispositivo entra na consulta, antes de escolher o anúncio', async () => {
    await service.ads({ placement: 'MODAL' }, 'mobile');

    expect(prisma.advertisement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          showOnMobile: true,
          status: 'ACTIVE',
          placement: 'MODAL',
          targetType: 'GENERAL',
        }),
        take: 1,
      }),
    );
  });

  describe('contagem', () => {
    const viewer = { ipAddress: '10.0.0.1', userAgent: IPHONE };

    it('conta uma impressão por pessoa na janela', async () => {
      const first = await service.track(
        { adId: AD, event: 'impression' },
        viewer,
      );
      const second = await service.track(
        { adId: AD, event: 'impression' },
        viewer,
      );

      expect(first.counted).toBe(true);
      expect(second.counted).toBe(false);
      expect(prisma.adStats.upsert).toHaveBeenCalledTimes(1);
    });

    it('grava com incremento atômico, no dia e dispositivo', async () => {
      await service.track({ adId: AD, event: 'click' }, viewer);

      const [args] = prisma.adStats.upsert.mock.calls[0] as [
        {
          where: { unique_daily_stats: { device: string } };
          update: unknown;
        },
      ];
      expect(args.where.unique_daily_stats.device).toBe('mobile');
      expect(args.update).toEqual({ clicks: { increment: 1 } });
    });

    // No legado, role === 1 (administrador) virava "professor".
    it('o nível sai de isTeacher, não do papel', async () => {
      await service.track(
        { adId: AD, event: 'impression' },
        { userId: 'u1', isTeacher: true, userAgent: IPHONE },
      );

      const [args] = prisma.adStats.upsert.mock.calls[0] as [
        { create: { userLevel: string } },
      ];
      expect(args.create.userLevel).toBe('TEACHER');
    });

    it('hover tem teto', async () => {
      await service.track(
        { adId: AD, event: 'hover', data: { duration: 3_000_000 } },
        viewer,
      );

      const [args] = prisma.adStats.upsert.mock.calls[0] as [
        { update: { hoverTime: { increment: number } } },
      ];
      expect(args.update.hoverTime.increment).toBe(60_000);
    });

    it('colisão na primeira gravação do dia vira incremento', async () => {
      prisma.adStats.upsert.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicado', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );

      await service.track({ adId: AD, event: 'impression' }, viewer);

      expect(prisma.adStats.update).toHaveBeenCalled();
    });

    it('anúncio inativo é 404', async () => {
      prisma.advertisement.findFirst.mockResolvedValue(null);

      await expect(
        service.track({ adId: AD, event: 'click' }, viewer),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
