import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AppCacheService } from '../../common/cache/cache.service';
import { StorageService } from '../../common/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ARTICLE_ASSET_ENTITY,
  BlogMediaService,
  DRAFT_ASSET_ENTITY,
} from './blog-media.service';

const ARTICLE = '690273c1ecac0fb66b3844e7';
const MEDIA = '6a0000000000000000000009';
const USER = '690273c1ecac0fb66b3844bb';
const CLOUD = 'https://res.cloudinary.com/opus/blog/a.png';

const file = { buffer: Buffer.from('x'), originalName: 'a.png', size: 1 };

function makePrisma() {
  return {
    blogArticle: {
      findUnique: jest.fn().mockResolvedValue({
        id: ARTICLE,
        status: 'PUBLISHED',
        publishedAt: new Date(Date.now() - 60_000),
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    blogCategory: { findMany: jest.fn().mockResolvedValue([]) },
    blogMedia: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: MEDIA, type: 'IMAGE', url: CLOUD }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: MEDIA, ...data }),
      ),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: MEDIA, ...data }),
      ),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    storedAsset: {
      findFirst: jest.fn().mockResolvedValue({ id: 'asset-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
  };
}

describe('BlogMediaService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let storage: { uploadFile: jest.Mock; deleteAsset: jest.Mock };
  let service: BlogMediaService;

  beforeEach(() => {
    prisma = makePrisma();
    storage = {
      uploadFile: jest.fn().mockResolvedValue({
        id: 'asset-novo',
        secureUrl: CLOUD,
        format: 'png',
        bytes: 1,
      }),
      deleteAsset: jest.fn().mockResolvedValue(undefined),
    };
    service = new BlogMediaService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      { invalidateMany: jest.fn() } as unknown as AppCacheService,
    );
  });

  const usedAsCover = (url: string) =>
    prisma.blogArticle.findMany.mockResolvedValue([
      {
        id: ARTICLE,
        title: 'Chopin',
        slug: 'chopin',
        coverImage: url,
        backgroundMusicUrl: null,
        content: { type: 'doc', content: [] },
      },
    ]);

  describe('upload', () => {
    it('com artigo, o arquivo é do artigo', async () => {
      await service.upload({
        file,
        folder: 'content',
        articleId: ARTICLE,
        userId: USER,
      });

      expect(storage.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'BLOG_MEDIA',
          entityType: ARTICLE_ASSET_ENTITY,
          entityId: ARTICLE,
        }),
        file,
      );
    });

    // Antes de o artigo existir, o arquivo é da sessão do formulário.
    it('sem artigo, o arquivo é da sessão', async () => {
      const result = await service.upload({
        file,
        folder: 'thumbnail',
        sessionId: 'sessao-123',
        userId: USER,
      });

      expect(storage.uploadFile.mock.calls[0][0]).toMatchObject({
        entityType: DRAFT_ASSET_ENTITY,
        entityId: 'sessao-123',
      });
      expect(result).toMatchObject({
        isTemporary: true,
        sessionId: 'sessao-123',
        url: CLOUD,
      });
    });

    it('áudio vai para o tipo de áudio', async () => {
      await service.upload({
        file,
        folder: 'audio',
        articleId: ARTICLE,
        userId: USER,
      });

      expect(storage.uploadFile.mock.calls[0][0].kind).toBe('BLOG_AUDIO');
    });

    it('artigo inexistente é 404, sem enviar nada', async () => {
      prisma.blogArticle.findUnique.mockResolvedValue(null);

      await expect(
        service.upload({ file, articleId: ARTICLE, userId: USER }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.uploadFile).not.toHaveBeenCalled();
    });
  });

  describe('remoção pelo endereço', () => {
    it('arquivo sem uso sai', async () => {
      const result = await service.removeUpload(CLOUD);

      expect(storage.deleteAsset).toHaveBeenCalledWith('asset-1');
      expect(result.deleted).toBe(true);
    });

    // O formulário apaga a capa antiga antes de salvar; se a pessoa desistir,
    // o artigo salvo ainda aponta para ela.
    it('arquivo em uso fica, sem erro', async () => {
      usedAsCover(CLOUD);

      const result = await service.removeUpload(CLOUD);

      expect(storage.deleteAsset).not.toHaveBeenCalled();
      expect(result).toMatchObject({ deleted: false });
    });

    it('arquivo do disco do legado não é apagado — a API não o alcança', async () => {
      prisma.storedAsset.findFirst.mockResolvedValue(null);

      const result = await service.removeUpload(
        '/uploads/blog/_temp/s/content/a.png',
      );

      expect(result).toMatchObject({ deleted: false });
      expect(result.message).toMatch(/disco do legado/);
    });
  });

  describe('mídia do artigo', () => {
    // No legado, sem o parâmetro, vinha só o que não estava na galeria.
    it('sem `inGallery`, não filtra', async () => {
      await service.listArticleMedia(ARTICLE, {});

      expect(prisma.blogMedia.findMany.mock.calls[0][0].where).toEqual({
        articleId: ARTICLE,
      });
    });

    it('com `inGallery`, filtra', async () => {
      await service.listArticleMedia(ARTICLE, { inGallery: true });

      expect(prisma.blogMedia.findMany.mock.calls[0][0].where).toEqual({
        articleId: ARTICLE,
        inGallery: true,
      });
    });

    it('galeria de rascunho só para administrador', async () => {
      prisma.blogArticle.findUnique.mockResolvedValue({
        id: ARTICLE,
        status: 'DRAFT',
        publishedAt: null,
      });

      await expect(
        service.listArticleMedia(ARTICLE, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.listArticleMedia(ARTICLE, {}, { role: 2 }),
      ).resolves.toMatchObject({ success: true });
    });

    it('recusa endereço perigoso', async () => {
      await expect(
        service.createMedia(ARTICLE, {
          type: 'IMAGE',
          url: 'javascript:alert(1)',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('vídeo aceita YouTube; imagem não', async () => {
      await expect(
        service.createMedia(ARTICLE, {
          type: 'VIDEO',
          url: 'https://www.youtube.com/watch?v=abc',
        }),
      ).resolves.toMatchObject({ success: true });
    });

    // O legado fazia `update({ data: body })`.
    it('a edição só leva os campos da mídia', async () => {
      await service.updateMedia(MEDIA, {
        title: ' Retrato ',
        articleId: 'outro',
      } as never);

      expect(prisma.blogMedia.update.mock.calls[0][0].data).toEqual({
        title: 'Retrato',
      });
    });

    it('tirar a mídia apaga o arquivo se ninguém mais o usa', async () => {
      const result = await service.deleteMedia(MEDIA);

      expect(prisma.blogMedia.delete).toHaveBeenCalledWith({
        where: { id: MEDIA },
      });
      expect(storage.deleteAsset).toHaveBeenCalledWith('asset-1');
      expect(result.fileDeleted).toBe(true);
    });
  });

  describe('galeria do painel', () => {
    it('mostra o arquivo do legado referenciado, sem remoção', async () => {
      usedAsCover('/uploads/blog/_temp/s1/thumbnail/capa.png');

      const { data } = await service.gallery({});

      expect(data.files).toEqual([
        expect.objectContaining({
          source: 'legacy-disk',
          isTemporary: true,
          deletable: false,
          category: 'legacy',
        }),
      ]);
      expect(data.stats.legacyDiskFiles).toBe(1);
    });

    it('filtra os não usados', async () => {
      prisma.storedAsset.findMany.mockResolvedValue([
        {
          id: 'a1',
          secureUrl: CLOUD,
          kind: 'BLOG_MEDIA',
          entityType: ARTICLE_ASSET_ENTITY,
          bytes: 10,
          createdAt: new Date(),
        },
        {
          id: 'a2',
          secureUrl: 'https://res.cloudinary.com/opus/b.png',
          kind: 'BLOG_MEDIA',
          entityType: DRAFT_ASSET_ENTITY,
          bytes: 10,
          createdAt: new Date(),
        },
      ]);
      usedAsCover(CLOUD);

      const { data } = await service.gallery({ usage: 'unused' });

      expect(data.files.map((item) => item.id)).toEqual(['a2']);
      expect(data.files[0]).toMatchObject({
        isTemporary: true,
        category: 'temp',
      });
    });

    // O legado apagava pelo caminho vindo do corpo, e arquivo em uso sem perguntar.
    it('apagar recusa arquivo em uso sem `force`, e o do legado', async () => {
      prisma.storedAsset.findMany.mockResolvedValue([
        { id: 'a1', secureUrl: CLOUD },
      ]);
      usedAsCover(CLOUD);

      const { data } = await service.deleteFromGallery({
        fileUrls: [CLOUD, '/uploads/../../.env'],
      });

      expect(storage.deleteAsset).not.toHaveBeenCalled();
      expect(data.failed.map((item) => item.url).sort()).toEqual(
        ['/uploads/../../.env', CLOUD].sort(),
      );
    });

    it('com `force`, apaga mesmo em uso, e tira a mídia que apontava para ele', async () => {
      prisma.storedAsset.findMany.mockResolvedValue([
        { id: 'a1', secureUrl: CLOUD },
      ]);
      usedAsCover(CLOUD);

      const { data } = await service.deleteFromGallery({
        fileUrls: [CLOUD],
        force: true,
      });

      expect(storage.deleteAsset).toHaveBeenCalledWith('a1');
      expect(prisma.blogMedia.deleteMany).toHaveBeenCalledWith({
        where: { url: CLOUD },
      });
      expect(data.removed).toEqual([CLOUD]);
    });

    it('sem nada a apagar é 400', async () => {
      await expect(service.deleteFromGallery({})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  it('o artigo adota os arquivos de rascunho que usa', async () => {
    const adopted = await service.adoptDrafts(ARTICLE, [CLOUD, CLOUD, '']);

    expect(prisma.storedAsset.updateMany).toHaveBeenCalledWith({
      where: {
        entityType: DRAFT_ASSET_ENTITY,
        secureUrl: { in: [CLOUD] },
        status: 'ACTIVE',
      },
      data: { entityType: ARTICLE_ASSET_ENTITY, entityId: ARTICLE },
    });
    expect(adopted).toBe(2);
  });
});
