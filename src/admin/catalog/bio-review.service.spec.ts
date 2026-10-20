import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AppCacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BioReviewService } from './bio-review.service';

const BIO = 'Uma biografia longa e cuidadosa. '.repeat(15);

const row = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'Chopin',
  fullName: 'Frédéric Chopin',
  portraitUrl: null,
  epochName: 'Romântico',
  bio: BIO,
  bioEn: BIO,
  bioGeneratedBy: 'anthropic/claude',
  bioGeneratedAt: new Date('2026-10-01'),
  bioTranslatedFrom: 'pt',
  bioReviewedAt: null,
  _count: { works: 12 },
  ...over,
});

describe('BioReviewService', () => {
  let prisma: {
    composer: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
  };
  let cache: { invalidateMany: jest.Mock };
  let service: BioReviewService;

  beforeEach(() => {
    prisma = {
      composer: {
        findMany: jest.fn().mockResolvedValue([row()]),
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'c1', bio: BIO, bioEn: BIO }),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve(row({ ...data }))),
        count: jest.fn().mockResolvedValue(3),
      },
    };
    cache = { invalidateMany: jest.fn().mockResolvedValue(undefined) };
    service = new BioReviewService(
      prisma as unknown as PrismaService,
      cache as unknown as AppCacheService,
    );
  });

  describe('fila', () => {
    it('pendente é IA sem revisão ou tradução de máquina, e conta as duas filas', async () => {
      const result = await service.list({});

      const [{ where }] = prisma.composer.findMany.mock.calls[0];
      const pending = where.AND[0];
      expect(pending.OR).toEqual([
        {
          AND: [
            { bioGeneratedBy: { not: null } },
            {
              OR: [
                { bioReviewedAt: { isSet: false } },
                { bioReviewedAt: null },
              ],
            },
          ],
        },
        { bioTranslatedFrom: { in: ['pt', 'en'] } },
      ]);
      expect(result.counts).toEqual({ pending: 3, reviewed: 3 });
      expect(result.items[0]).toMatchObject({
        id: 'c1',
        name: 'Frédéric Chopin',
        writtenByAi: true,
        translatedFrom: 'pt',
        reviewedAt: null,
        worksCount: 12,
      });
    });

    it('revisadas: leu e nada novo espera depois', async () => {
      await service.list({ status: 'reviewed' });

      const [{ where }] = prisma.composer.findMany.mock.calls[0];
      expect(where.AND[0].AND[0]).toEqual({ bioReviewedAt: { not: null } });
      expect(where.AND[0].AND[1]).toHaveProperty('NOT');
    });

    it('busca pelo nome sem tratar o termo como expressão regular', async () => {
      await service.list({ search: 'bach (j.s.)' });

      const [{ where }] = prisma.composer.findMany.mock.calls[0];
      const nameFilter = where.AND[1].OR[0].name;
      expect(nameFilter.contains).toBe('bach \\(j\\.s\\.\\)');
    });

    it('continua do cursor e devolve o próximo', async () => {
      prisma.composer.findMany.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => row({ id: `c${i}` })),
      );

      const result = await service.list({ cursor: 'c9', limit: 20 });

      const [{ cursor, skip, take }] = prisma.composer.findMany.mock.calls[0];
      expect({ cursor, skip, take }).toEqual({
        cursor: { id: 'c9' },
        skip: 1,
        take: 20,
      });
      expect(result.nextCursor).toBe('c19');
    });
  });

  describe('revisar', () => {
    it('aprovar sem corpo mantém o texto e a origem, marca a revisão e solta a tradução', async () => {
      await service.review('admin-1', 'c1', {});

      const [{ data }] = prisma.composer.update.mock.calls[0];
      expect(data).toMatchObject({
        bioReviewedAt: expect.any(Date),
        bioReviewedBy: 'admin-1',
        bioTranslatedFrom: null,
      });
      // Origem honesta: ainda escrita por IA, agora revisada.
      expect(data).not.toHaveProperty('bioGeneratedBy');
      expect(data).not.toHaveProperty('bio');
      expect(cache.invalidateMany).toHaveBeenCalled();
    });

    it('reescrever em português torna o texto de uma pessoa', async () => {
      const novo = 'Texto reescrito pela equipe com cuidado. '.repeat(10);

      await service.review('admin-1', 'c1', { bio: `  ${novo}  ` });

      const [{ data }] = prisma.composer.update.mock.calls[0];
      expect(data).toMatchObject({
        bio: novo.trim(),
        bioGeneratedBy: null,
        bioGeneratedAt: null,
      });
    });

    it('texto igual ao atual não conta como reescrita', async () => {
      await service.review('admin-1', 'c1', { bio: BIO, bioEn: BIO });

      const [{ data }] = prisma.composer.update.mock.calls[0];
      expect(data).not.toHaveProperty('bio');
      expect(data).not.toHaveProperty('bioEn');
      expect(data).not.toHaveProperty('bioGeneratedBy');
    });

    it('reescrever só a tradução não mexe no texto original', async () => {
      const en = 'Rewritten English text by the team. '.repeat(12);

      await service.review('admin-1', 'c1', { bioEn: en });

      const [{ data }] = prisma.composer.update.mock.calls[0];
      expect(data.bioEn).toBe(en.trim());
      expect(data).not.toHaveProperty('bio');
      expect(data).not.toHaveProperty('bioGeneratedBy');
    });

    it('compositor inexistente é 404; sem biografia nenhuma, 400', async () => {
      prisma.composer.findUnique.mockResolvedValueOnce(null);
      await expect(service.review('a', 'x', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );

      prisma.composer.findUnique.mockResolvedValueOnce({
        id: 'c1',
        bio: null,
        bioEn: null,
      });
      await expect(service.review('a', 'c1', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.composer.update).not.toHaveBeenCalled();
    });
  });
});
