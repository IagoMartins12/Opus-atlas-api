import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { StorageAssetKind } from '@prisma/client';
import { AppCacheService } from '../../common/cache/cache.service';
import { StorageService } from '../../common/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CATEGORY_ASSET_ENTITY,
  CategoriesAdminService,
} from './categories-admin.service';

const A = '690246e3f1996f61148e5b36';
const B = '69028e66ecac0fb66b38450f';
const C = '6914c4e867f8bcb9424fc1b7';
const USER = '690273c1ecac0fb66b3844bb';

function makePrisma() {
  const prisma = {
    blogCategory: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({ id: A, parentId: null }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: A, ...data }),
      ),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: A, ...data }),
      ),
      delete: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    blogArticleCategory: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn(),
  };

  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) =>
    fn(prisma),
  );

  return prisma;
}

describe('CategoriesAdminService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let cache: { invalidateMany: jest.Mock };
  let storage: {
    uploadFile: jest.Mock;
    findActiveByEntity: jest.Mock;
    deleteAsset: jest.Mock;
    deleteByEntity: jest.Mock;
  };
  let service: CategoriesAdminService;

  beforeEach(() => {
    prisma = makePrisma();
    cache = { invalidateMany: jest.fn().mockResolvedValue(undefined) };
    storage = {
      uploadFile: jest.fn().mockResolvedValue({
        id: 'asset-novo',
        secureUrl: 'https://res.cloudinary.com/x/nova.webp',
      }),
      findActiveByEntity: jest
        .fn()
        .mockResolvedValue([{ id: 'asset-novo' }, { id: 'asset-velho' }]),
      deleteAsset: jest.fn().mockResolvedValue(undefined),
      deleteByEntity: jest.fn().mockResolvedValue(1),
    };
    service = new CategoriesAdminService(
      prisma as unknown as PrismaService,
      cache as unknown as AppCacheService,
      storage as unknown as StorageService,
    );
  });

  const updateData = () => prisma.blogCategory.update.mock.calls[0][0].data;

  describe('create', () => {
    it('deriva o slug do nome e entra no fim da ordem', async () => {
      prisma.blogCategory.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ order: 2 });

      await service.create({ name: ' Música Barroca ', icon: '🎻' });

      expect(prisma.blogCategory.create.mock.calls[0][0].data).toMatchObject({
        name: 'Música Barroca',
        slug: 'musica-barroca',
        icon: '🎻',
        order: 3,
      });
    });

    it('slug já usado é conflito', async () => {
      prisma.blogCategory.findFirst.mockResolvedValue({ id: B });

      await expect(service.create({ name: 'Barroco' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('mãe inexistente é recusada', async () => {
      prisma.blogCategory.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ name: 'Sub', parentId: B }),
      ).rejects.toThrow(/mãe inexistente/);
    });

    // A base já tem imagens em `/uploads/blog/categories/…`.
    it('aceita caminho do próprio site e recusa endereço perigoso', async () => {
      await service.create({
        name: 'Romântico',
        image: '/uploads/blog/categories/a.jpeg',
      });
      expect(prisma.blogCategory.create.mock.calls[0][0].data.image).toBe(
        '/uploads/blog/categories/a.jpeg',
      );

      await expect(
        service.create({ name: 'X', image: 'javascript:alert(1)' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    // No legado, `data: body` aceitava escrita aninhada nas relações.
    it('só os campos da categoria chegam ao banco', async () => {
      await service.update(A, {
        isActive: false,
        articles: { deleteMany: {} },
      } as never);

      expect(updateData()).toEqual({ isActive: false });
    });

    it('não pode ser mãe de si mesma', async () => {
      await expect(service.update(A, { parentId: A })).rejects.toThrow(
        /si mesma/,
      );
    });

    // O legado só recusava o caso acima: com A mãe de B, tornar B mãe de A
    // passava, e a árvore ficava sem topo.
    it('recusa ciclo na hierarquia', async () => {
      prisma.blogCategory.findUnique.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve(
            where.id === B
              ? { id: B, parentId: C }
              : where.id === C
                ? { id: C, parentId: A }
                : { id: A, parentId: null },
          ),
      );

      await expect(service.update(A, { parentId: B })).rejects.toThrow(/ciclo/);
      expect(prisma.blogCategory.update).not.toHaveBeenCalled();
    });

    it('aceita mãe válida', async () => {
      prisma.blogCategory.findUnique.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id, parentId: null }),
      );

      await service.update(A, { parentId: B });

      expect(updateData()).toEqual({ parentId: B });
    });

    it('confere o slug ignorando a própria categoria', async () => {
      await service.update(A, { slug: 'novo' });

      expect(prisma.blogCategory.findFirst.mock.calls[0][0].where).toEqual({
        slug: 'novo',
        id: { not: A },
      });
    });

    it('voltar ao topo aceita mãe nula', async () => {
      await service.update(A, { parentId: null });

      expect(updateData()).toEqual({ parentId: null });
    });
  });

  describe('remove', () => {
    // A rota que o painel usava só conferia artigos: as filhas ficavam
    // apontando para uma mãe que não existe mais.
    it('recusa categoria com subcategorias', async () => {
      prisma.blogCategory.count.mockResolvedValue(1);

      await expect(service.remove(A)).rejects.toThrow(/subcategoria/);
      expect(prisma.blogCategory.delete).not.toHaveBeenCalled();
    });

    it('recusa categoria com artigos', async () => {
      prisma.blogArticleCategory.count.mockResolvedValue(3);

      await expect(service.remove(A)).rejects.toThrow(/3 artigo/);
    });

    it('categoria vazia sai, com os arquivos dela', async () => {
      await service.remove(A);

      expect(prisma.blogCategory.delete).toHaveBeenCalledWith({
        where: { id: A },
      });
      expect(storage.deleteByEntity).toHaveBeenCalledWith(
        CATEGORY_ASSET_ENTITY,
        A,
      );
    });
  });

  describe('reorder', () => {
    it('recusa categoria repetida', async () => {
      await expect(
        service.reorder([
          { id: A, order: 0 },
          { id: A, order: 1 },
        ]),
      ).rejects.toThrow(/duas vezes/);
    });

    it('recusa id inexistente sem gravar nenhuma posição', async () => {
      prisma.blogCategory.findMany.mockResolvedValue([{ id: A }]);

      await expect(
        service.reorder([
          { id: A, order: 1 },
          { id: B, order: 0 },
        ]),
      ).rejects.toThrow(B);
      expect(prisma.blogCategory.update).not.toHaveBeenCalled();
    });

    it('grava as posições numa transação', async () => {
      prisma.blogCategory.findMany.mockResolvedValue([{ id: A }, { id: B }]);

      await service.reorder([
        { id: A, order: 1 },
        { id: B, order: 0 },
      ]);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.blogCategory.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('imagem', () => {
    const file = { buffer: Buffer.from('x'), originalName: 'a.webp', size: 1 };

    it('envia ligada à categoria e grava a URL', async () => {
      await service.uploadImage(A, file, USER);

      expect(storage.uploadFile).toHaveBeenCalledWith(
        {
          kind: StorageAssetKind.BLOG_MEDIA,
          scopeId: A,
          entityType: CATEGORY_ASSET_ENTITY,
          entityId: A,
          ownerId: USER,
        },
        file,
      );
      expect(updateData()).toEqual({
        image: 'https://res.cloudinary.com/x/nova.webp',
      });
    });

    // `BLOG_MEDIA` não substitui o anterior sozinho; na categoria só há uma.
    it('apaga a imagem anterior, e só ela', async () => {
      await service.uploadImage(A, file, USER);

      expect(storage.deleteAsset).toHaveBeenCalledTimes(1);
      expect(storage.deleteAsset).toHaveBeenCalledWith('asset-velho');
    });

    it('não envia para categoria inexistente', async () => {
      prisma.blogCategory.findUnique.mockResolvedValue(null);

      await expect(service.uploadImage(A, file, USER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(storage.uploadFile).not.toHaveBeenCalled();
    });

    // O legado apagava por `?url=`, com `path.join` resolvendo `..`.
    it('remove pela categoria, nunca por caminho', async () => {
      await service.removeImage(A);

      expect(storage.deleteByEntity).toHaveBeenCalledWith(
        CATEGORY_ASSET_ENTITY,
        A,
      );
      expect(updateData()).toEqual({ image: null });
    });
  });

  it('id malformado é 404, sem consultar o banco', async () => {
    await expect(service.remove('../../.env')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.blogCategory.findUnique).not.toHaveBeenCalled();
  });
});
