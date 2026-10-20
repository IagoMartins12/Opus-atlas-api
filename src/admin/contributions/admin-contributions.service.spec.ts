import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AppCacheService } from '../../common/cache/cache.service';
import { ContributionsService } from '../../library/contributions/contributions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminContributionsService } from './admin-contributions.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'k1',
  userId: 'u1',
  kind: 'BIO',
  field: 'bio',
  entityType: 'composer',
  entityId: 'c1',
  before: 'antes',
  after: 'depois',
  curiosityId: null,
  source: null,
  xp: 30,
  xpGrantedAt: null,
  revertedAt: null,
  createdAt: new Date('2026-10-10'),
  user: {
    id: 'u1',
    firstName: 'Ana',
    lastName: 'Lima',
    username: 'ana',
    email: 'ana@x.com',
  },
  ...over,
});

describe('AdminContributionsService', () => {
  let prisma: {
    contribution: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
    };
    user: { findMany: jest.Mock };
    composer: { findMany: jest.Mock };
    work: { findMany: jest.Mock };
    composerCuriosity: { findMany: jest.Mock };
  };
  let contributions: {
    revert: jest.Mock;
    deleteCuriosity: jest.Mock;
    notifyRejected: jest.Mock;
  };
  let cache: { invalidateMany: jest.Mock };
  let service: AdminContributionsService;

  beforeEach(() => {
    prisma = {
      contribution: {
        findMany: jest.fn().mockResolvedValue([row()]),
        findUnique: jest.fn().mockResolvedValue(row()),
        count: jest.fn().mockResolvedValue(4),
      },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1' }]) },
      composer: {
        findMany: jest.fn().mockResolvedValue([{ id: 'c1', name: 'Chopin' }]),
      },
      work: { findMany: jest.fn().mockResolvedValue([]) },
      composerCuriosity: { findMany: jest.fn().mockResolvedValue([]) },
    };
    contributions = {
      revert: jest.fn().mockResolvedValue(undefined),
      deleteCuriosity: jest.fn().mockResolvedValue(undefined),
      notifyRejected: jest.fn().mockResolvedValue(undefined),
    };
    cache = { invalidateMany: jest.fn().mockResolvedValue(undefined) };
    service = new AdminContributionsService(
      prisma as unknown as PrismaService,
      contributions as unknown as ContributionsService,
      cache as unknown as AppCacheService,
    );
  });

  describe('lista', () => {
    it('em vigor por padrão, com o nome do compositor e as duas contagens', async () => {
      const result = await service.list({});

      expect(result.items[0]).toMatchObject({
        id: 'k1',
        entityName: 'Chopin',
        author: { name: 'Ana Lima', username: 'ana' },
      });
      expect(result.counts).toEqual({ live: 4, reverted: 4 });
      const [{ where }] = prisma.contribution.findMany.mock.calls[0];
      expect(JSON.stringify(where)).toContain('isSet');
    });

    it('reprovadas pedem revertedAt preenchido', async () => {
      await service.list({ status: 'reverted' });

      const [{ where }] = prisma.contribution.findMany.mock.calls[0];
      expect(JSON.stringify(where)).toContain('"revertedAt":{"not":null}');
    });

    it('a busca é por autor, e o tipo filtra', async () => {
      await service.list({ search: 'ana', kind: 'VIDEO' });

      const [{ where }] = prisma.contribution.findMany.mock.calls[0];
      expect(JSON.stringify(where)).toContain('"kind":"VIDEO"');
      expect(JSON.stringify(where)).toContain('"userId":{"in":["u1"]}');
    });
  });

  describe('reprovar', () => {
    it('desfaz, devolve o XP já pago e avisa o autor com o motivo', async () => {
      prisma.contribution.findUnique.mockResolvedValue(
        row({ xpGrantedAt: new Date('2026-10-17') }),
      );

      const result = await service.reject('k1', { reason: 'Fonte duvidosa' });

      expect(contributions.revert).toHaveBeenCalledWith('k1', true);
      expect(cache.invalidateMany).toHaveBeenCalled();
      expect(contributions.notifyRejected).toHaveBeenCalledWith(
        'u1',
        'k1',
        'Fonte duvidosa',
        30,
      );
      expect(result).toEqual({ id: 'k1', xpReturned: 30 });
    });

    it('XP ainda não pago: nada a devolver, e é dito', async () => {
      const result = await service.reject('k1', { reason: 'Texto copiado' });

      expect(result.xpReturned).toBe(0);
      expect(contributions.notifyRejected).toHaveBeenCalledWith(
        'u1',
        'k1',
        'Texto copiado',
        0,
      );
    });

    it('curiosidade sai pela própria curiosidade', async () => {
      prisma.contribution.findUnique.mockResolvedValue(
        row({ kind: 'CURIOSITY', curiosityId: 'q1' }),
      );

      await service.reject('k1', { reason: 'Não confere' });

      expect(contributions.deleteCuriosity).toHaveBeenCalledWith('q1');
      expect(contributions.revert).not.toHaveBeenCalled();
    });

    it('já reprovada é 400; inexistente é 404', async () => {
      prisma.contribution.findUnique.mockResolvedValue(
        row({ revertedAt: new Date() }),
      );
      await expect(
        service.reject('k1', { reason: 'De novo' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      prisma.contribution.findUnique.mockResolvedValue(null);
      await expect(
        service.reject('x', { reason: 'Nada aqui' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(contributions.revert).not.toHaveBeenCalled();
    });
  });
});
