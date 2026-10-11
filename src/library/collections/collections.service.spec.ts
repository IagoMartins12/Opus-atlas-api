import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppCacheService } from '../../common/cache/cache.service';
import { ComposersService } from '../../catalog/composers/composers.service';
import { WorksService } from '../../catalog/works/works.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CollectionsService } from './collections.service';

const owner = {
  id: 'u-1',
  firstName: 'Marina',
  lastName: 'Duarte',
  username: null,
};
const row = (over: Record<string, unknown> = {}) => ({
  id: 'col-1',
  ownerId: 'u-1',
  kind: 'COMPOSER',
  title: 'A noite no piano',
  description: null,
  isPublic: true,
  featuredOnHome: false,
  isHidden: null,
  favoritesCount: 3,
  items: [
    { refId: 'c-1', note: 'Comece por aqui' },
    { refId: 'c-gone', note: null },
  ],
  updatedAt: new Date('2026-10-01'),
  owner,
  ...over,
});

describe('CollectionsService', () => {
  let service: CollectionsService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let cache: { invalidateMany: jest.Mock };

  beforeEach(async () => {
    prisma = {
      collection: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ favoritesCount: 4 }),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'col-1' }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        delete: jest.fn().mockResolvedValue({}),
      },
      collectionFavorite: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ emailVerified: new Date() }),
      },
      composer: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'c-1',
            name: 'Chopin',
            fullName: 'Frédéric Chopin',
            portraitUrl: '/chopin.webp',
            birthYear: 1810,
            deathYear: 1849,
            nationality: 'Polônia',
          },
        ]),
      },
      work: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn() },
      workScore: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn() },
    };
    cache = { invalidateMany: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CollectionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AppCacheService, useValue: cache },
        { provide: ComposersService, useValue: { findAll: jest.fn() } },
        { provide: WorksService, useValue: { search: jest.fn() } },
      ],
    }).compile();
    service = module.get(CollectionsService);
  });

  describe('get', () => {
    it('resolve os itens, mantém a nota e some com o que foi apagado', async () => {
      prisma.collection.findUnique.mockResolvedValue(row());

      const c = await service.get('col-1');

      expect(c.items).toHaveLength(1);
      expect(c.items[0]).toMatchObject({
        refId: 'c-1',
        title: 'Frédéric Chopin',
        note: 'Comece por aqui',
        birthYear: 1810,
      });
      expect(c.faces).toEqual([
        { name: 'Chopin', portraitUrl: '/chopin.webp' },
      ]);
      expect(c.owner.name).toBe('Marina Duarte');
      expect(c.mine).toBe(false);
    });

    it('privada só para o dono', async () => {
      prisma.collection.findUnique.mockResolvedValue(row({ isPublic: false }));

      await expect(service.get('col-1', 'outro')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.get('col-1', 'u-1')).resolves.toMatchObject({
        mine: true,
      });
    });

    it('retida por denúncia some para os outros', async () => {
      prisma.collection.findUnique.mockResolvedValue(row({ isHidden: true }));

      await expect(service.get('col-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    const dto = {
      kind: 'COMPOSER' as const,
      title: '  Escola polonesa ',
      isPublic: true,
      items: [{ refId: 'c-1', note: '  ' }],
    };

    it('exige e-mail confirmado', async () => {
      prisma.user.findUnique.mockResolvedValue({ emailVerified: null });

      await expect(service.create('u-1', dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('recusa item repetido', async () => {
      await expect(
        service.create('u-1', {
          ...dto,
          items: [{ refId: 'c-1' }, { refId: 'c-1' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // O tipo mora na coleção: id de obra numa coleção de compositores não conta.
    it('recusa item de outro tipo ou inexistente', async () => {
      prisma.composer.count.mockResolvedValue(0);

      await expect(service.create('u-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('grava limpo e derruba o cache das coleções', async () => {
      prisma.collection.findUnique.mockResolvedValue(row());

      await service.create('u-1', dto);

      expect(prisma.collection.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: 'Escola polonesa',
          description: null,
          items: [{ refId: 'c-1', note: null }],
        }),
      });
      expect(cache.invalidateMany).toHaveBeenCalledWith(['collections']);
    });
  });

  describe('update', () => {
    it('privada sai da home', async () => {
      prisma.collection.findUnique
        .mockResolvedValueOnce({ ownerId: 'u-1', kind: 'COMPOSER' })
        .mockResolvedValue(row({ isPublic: false }));

      await service.update('u-1', 'col-1', {
        title: 'A noite',
        isPublic: false,
        items: [{ refId: 'c-1' }],
      });

      expect(prisma.collection.update.mock.calls[0][0].data).toMatchObject({
        isPublic: false,
        featuredOnHome: false,
      });
    });

    it('de outra pessoa não', async () => {
      prisma.collection.findUnique.mockResolvedValue({
        ownerId: 'outro',
        kind: 'COMPOSER',
      });

      await expect(
        service.update('u-1', 'col-1', {
          title: 'X',
          isPublic: true,
          items: [],
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('favorite', () => {
    it('favorita uma vez e conta', async () => {
      prisma.collection.findUnique.mockResolvedValue({
        ownerId: 'outro',
        isPublic: true,
        isHidden: null,
      });

      const result = await service.favorite('u-1', 'col-1', true);

      expect(prisma.collectionFavorite.create).toHaveBeenCalled();
      expect(prisma.collection.update).toHaveBeenCalledWith({
        where: { id: 'col-1' },
        data: { favoritesCount: { increment: 1 } },
      });
      expect(result).toEqual({ favorited: true, favoritesCount: 4 });
    });

    it('a própria não', async () => {
      prisma.collection.findUnique.mockResolvedValue({
        ownerId: 'u-1',
        isPublic: true,
        isHidden: null,
      });

      await expect(service.favorite('u-1', 'col-1', true)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  it('só coleção pública vai para a home', async () => {
    prisma.collection.findUnique.mockResolvedValue({
      isPublic: false,
      isHidden: null,
    });

    await expect(service.setFeatured('col-1', true)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('partituras: as da obra escolhida', async () => {
    prisma.workScore.findMany
      .mockResolvedValueOnce([{ id: 's-1' }, { id: 's-2' }])
      .mockResolvedValueOnce([
        { id: 's-1', title: 'Edição Mikuli', pageCount: '25', work: null },
        { id: 's-2', title: 'Urtext', pageCount: null, work: null },
      ]);

    const found = await service.candidates({ kind: 'SCORE', workId: 'w-1' });

    expect(prisma.workScore.findMany.mock.calls[0][0].where).toEqual({
      workId: 'w-1',
      isActive: true,
    });
    expect(found.map((e) => e.title)).toEqual(['Edição Mikuli', 'Urtext']);
  });
});
