import { ForbiddenException } from '@nestjs/common';
import { ContributionLimitService } from './contribution-limit.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SubscriptionsService } from '../../billing/services/subscriptions.service';

describe('ContributionLimitService', () => {
  const prisma = {
    composer: { count: jest.fn() },
    work: { count: jest.fn() },
    workScore: { count: jest.fn() },
    user: { findUnique: jest.fn() },
  };
  const subscriptions = { checkFeatureAccess: jest.fn() };
  const service = new ContributionLimitService(
    prisma as unknown as PrismaService,
    subscriptions as unknown as SubscriptionsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.composer.count.mockResolvedValue(5);
    prisma.work.count.mockResolvedValue(10);
    prisma.workScore.count.mockResolvedValue(4);
    prisma.user.findUnique.mockResolvedValue({ emailVerified: new Date() });
  });

  // Contribuir ao acervo exige e-mail confirmado, como completar ficha.
  it('e-mail não confirmado não contribui, nem chega a olhar o plano', async () => {
    prisma.user.findUnique.mockResolvedValue({ emailVerified: null });

    await expect(service.assertWithinLimit('u1')).rejects.toThrow(
      'Confirme seu e-mail para contribuir com o acervo.',
    );
    expect(subscriptions.checkFeatureAccess).not.toHaveBeenCalled();
  });

  it('conta que não existe também não contribui', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.assertWithinLimit('u1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('soma compositores, obras e partituras criados pela pessoa', async () => {
    await expect(service.countContributions('u1')).resolves.toBe(19);
    expect(prisma.composer.count).toHaveBeenCalledWith({
      where: { createdBy: 'u1' },
    });
    expect(prisma.workScore.count).toHaveBeenCalledWith({
      where: { uploadedBy: 'u1' },
    });
  });

  it('libera abaixo do limite do plano', async () => {
    subscriptions.checkFeatureAccess.mockResolvedValue({
      plan: 'FREE',
      limit: 20,
    });
    await expect(service.assertWithinLimit('u1')).resolves.toBeUndefined();
  });

  it('bloqueia ao chegar no limite, contando os três tipos juntos', async () => {
    subscriptions.checkFeatureAccess.mockResolvedValue({
      plan: 'FREE',
      limit: 20,
    });
    prisma.workScore.count.mockResolvedValue(5);
    await expect(service.assertWithinLimit('u1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('plano ilimitado (-1) não conta nada', async () => {
    subscriptions.checkFeatureAccess.mockResolvedValue({
      plan: 'PLUS',
      limit: -1,
    });
    await expect(service.assertWithinLimit('u1')).resolves.toBeUndefined();
    expect(prisma.composer.count).not.toHaveBeenCalled();
  });
});
