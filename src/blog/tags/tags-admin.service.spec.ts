import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AppCacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TagsAdminService } from './tags-admin.service';

const ID = '690273c1ecac0fb66b3844e7';

function makePrisma() {
  return {
    blogTag: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({ id: ID }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: ID, ...data }),
      ),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: ID, ...data }),
      ),
      delete: jest.fn().mockResolvedValue({}),
    },
    blogArticleTag: { count: jest.fn().mockResolvedValue(0) },
  };
}

describe('TagsAdminService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let cache: { invalidateMany: jest.Mock };
  let service: TagsAdminService;

  beforeEach(() => {
    prisma = makePrisma();
    cache = { invalidateMany: jest.fn().mockResolvedValue(undefined) };
    service = new TagsAdminService(
      prisma as unknown as PrismaService,
      cache as unknown as AppCacheService,
    );
  });

  describe('create', () => {
    // O mesmo algoritmo da gravação de artigo, ou ela não acharia a tag.
    it('sem slug, deriva do nome como a gravação de artigo', async () => {
      await service.create({ name: ' Ópera Romântica ' });

      expect(prisma.blogTag.create.mock.calls[0][0].data).toMatchObject({
        name: 'Ópera Romântica',
        slug: 'opera-romantica',
      });
    });

    it('usa o slug informado', async () => {
      await service.create({ name: 'Chopin', slug: 'frederic-chopin' });

      expect(prisma.blogTag.create.mock.calls[0][0].data.slug).toBe(
        'frederic-chopin',
      );
    });

    it('nome sem letra nem número é recusado', async () => {
      await expect(service.create({ name: '!!!' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    // O legado só conferia o slug: nome repetido estourava no índice, com 500.
    it('nome já usado é conflito', async () => {
      prisma.blogTag.findFirst.mockResolvedValue({
        name: 'Chopin',
        slug: 'chopin-compositor',
      });

      await expect(
        service.create({ name: 'Chopin', slug: 'outro' }),
      ).rejects.toThrow(/chamada "Chopin"/);
    });

    it('slug já usado é conflito', async () => {
      prisma.blogTag.findFirst.mockResolvedValue({ name: 'X', slug: 'chopin' });

      await expect(service.create({ name: 'Chopin' })).rejects.toThrow(
        /slug "chopin"/,
      );
    });

    it('derruba o cache de tags e de artigos', async () => {
      await service.create({ name: 'Chopin' });

      expect(cache.invalidateMany).toHaveBeenCalledWith([
        'blog:tags',
        'blog:articles',
      ]);
    });
  });

  describe('update', () => {
    // No legado, `data: body` aceitava escrita aninhada nas relações da tag.
    it('só os campos da tag chegam ao banco', async () => {
      await service.update(ID, {
        name: 'Novo',
        articles: { deleteMany: {} },
      } as never);

      expect(prisma.blogTag.update).toHaveBeenCalledWith({
        where: { id: ID },
        data: { name: 'Novo' },
      });
    });

    it('confere conflito ignorando a própria tag', async () => {
      await service.update(ID, { slug: 'novo' });

      expect(prisma.blogTag.findFirst.mock.calls[0][0].where).toEqual({
        OR: [{ slug: 'novo' }],
        id: { not: ID },
      });
    });

    it('conflito com outra tag é recusado', async () => {
      prisma.blogTag.findFirst.mockResolvedValue({ name: 'X', slug: 'novo' });

      await expect(service.update(ID, { slug: 'novo' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('nome vazio é recusado', async () => {
      await expect(service.update(ID, { name: '   ' })).rejects.toThrow(
        /vazio/,
      );
    });

    it('descrição vazia vira nula', async () => {
      await service.update(ID, { description: '  ' });

      expect(prisma.blogTag.update.mock.calls[0][0].data).toEqual({
        description: null,
      });
    });
  });

  describe('remove', () => {
    it('tag em uso não é apagada', async () => {
      prisma.blogArticleTag.count.mockResolvedValue(2);

      await expect(service.remove(ID)).rejects.toThrow(/2 artigo/);
      expect(prisma.blogTag.delete).not.toHaveBeenCalled();
    });

    it('tag sem uso é apagada', async () => {
      await service.remove(ID);

      expect(prisma.blogTag.delete).toHaveBeenCalledWith({ where: { id: ID } });
    });
  });

  it('id malformado é 404, sem consultar o banco', async () => {
    await expect(service.remove('xyz')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.blogTag.findUnique).not.toHaveBeenCalled();
  });

  it('tag inexistente é 404', async () => {
    prisma.blogTag.findUnique.mockResolvedValue(null);

    await expect(service.update(ID, { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
