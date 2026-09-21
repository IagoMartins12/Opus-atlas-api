import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ArticleStatus } from '@prisma/client';
import { AppCacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BlogMediaService } from '../media/blog-media.service';
import { ArticleWriterService } from './article-writer.service';

const ID = '690273c1ecac0fb66b3844e7';
const CAT = '690273c1ecac0fb66b3844aa';
const USER = '690273c1ecac0fb66b3844bb';

const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

const validDoc = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'um dois três' }] },
  ],
};

const unsafeDoc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'x',
          marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
        },
      ],
    },
  ],
};

const existing = {
  id: ID,
  slug: 'chopin',
  title: 'Chopin',
  version: 3,
  status: ArticleStatus.PUBLISHED,
  publishedAt: yesterday,
  scheduledFor: null,
  isFeatured: false,
  featuredOrder: null,
  tags: [{ tagId: 'tag-old' }],
};

function makePrisma() {
  const prisma = {
    blogArticle: {
      findUnique: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: ID, title: 'T' }),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: ID, title: 'T' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn().mockResolvedValue({}),
    },
    blogCategory: { findMany: jest.fn().mockResolvedValue([]) },
    blogArticleCategory: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    blogArticleTag: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(1),
    },
    blogTag: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(({ data }: { data: { slug: string } }) =>
        Promise.resolve({ id: `tag-${data.slug}` }),
      ),
      update: jest.fn(),
    },
    blogArticleVersion: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(),
  };

  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) =>
    fn(prisma),
  );

  return prisma;
}

describe('ArticleWriterService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let cache: { invalidateMany: jest.Mock };
  let media: { adoptDrafts: jest.Mock };
  let service: ArticleWriterService;

  beforeEach(() => {
    prisma = makePrisma();
    cache = { invalidateMany: jest.fn().mockResolvedValue(undefined) };
    media = { adoptDrafts: jest.fn().mockResolvedValue(0) };
    service = new ArticleWriterService(
      prisma as unknown as PrismaService,
      cache as unknown as AppCacheService,
      media as unknown as BlogMediaService,
    );
  });

  const createData = () => prisma.blogArticle.create.mock.calls[0][0].data;
  const updateCall = () => prisma.blogArticle.updateMany.mock.calls[0][0];

  describe('create', () => {
    it('grava artigo, relações e versão 1 numa transação só', async () => {
      prisma.blogCategory.findMany.mockResolvedValue([{ id: CAT }]);
      prisma.blogArticleCategory.findMany.mockResolvedValue([
        { categoryId: CAT },
      ]);
      prisma.blogArticleTag.findMany.mockResolvedValue([
        { tag: { name: 'Romântico' } },
      ]);

      await service.create(
        {
          title: ' Chopin ',
          slug: 'chopin',
          content: validDoc,
          categoryIds: [CAT],
          tags: ['Romântico'],
        },
        USER,
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(createData()).toMatchObject({
        title: 'Chopin',
        slug: 'chopin',
        authorId: USER,
        version: 1,
        status: ArticleStatus.DRAFT,
        estimatedReadTime: 1,
      });
      expect(prisma.blogArticleCategory.createMany).toHaveBeenCalledWith({
        data: [{ articleId: ID, categoryId: CAT }],
      });
      expect(
        prisma.blogArticleVersion.create.mock.calls[0][0].data,
      ).toMatchObject({
        articleId: ID,
        version: 1,
        editedBy: USER,
        changeLog: 'Versão inicial',
        // O legado não guardava nenhuma das duas no snapshot.
        snapshot: { categoryIds: [CAT], tagNames: ['Romântico'] },
      });
      expect(cache.invalidateMany).toHaveBeenCalled();
    });

    // A imagem enviada antes de o artigo existir passa a ser dele.
    it('adota os arquivos de rascunho que o artigo usa', async () => {
      prisma.blogArticle.create.mockResolvedValue({
        id: ID,
        title: 'T',
        coverImage: 'https://res.cloudinary.com/x/capa.png',
        backgroundMusicUrl: null,
        content: {
          type: 'doc',
          content: [
            {
              type: 'image',
              attrs: { src: 'https://res.cloudinary.com/x/a.png' },
            },
          ],
        },
      });

      await service.create({ title: 'T', slug: 't', content: validDoc }, USER);

      expect(media.adoptDrafts).toHaveBeenCalledWith(
        ID,
        expect.arrayContaining([
          'https://res.cloudinary.com/x/a.png',
          'https://res.cloudinary.com/x/capa.png',
        ]),
      );
    });

    it('falha ao adotar não desfaz a gravação', async () => {
      media.adoptDrafts.mockRejectedValue(new Error('storage fora'));

      await expect(
        service.create({ title: 'T', slug: 't' }, USER),
      ).resolves.toMatchObject({ success: true });
    });

    it('sem conteúdo, grava o documento vazio do editor', async () => {
      await service.create({ title: 'T', slug: 't' }, USER);

      expect(createData().content).toEqual({ type: 'doc', content: [] });
    });

    it('conteúdo recusado aponta o bloco, e nada é gravado', async () => {
      await expect(
        service.create({ title: 'T', slug: 't', content: unsafeDoc }, USER),
      ).rejects.toThrow(
        /content\.content\[0\]\.content\[0\]\.marks\[0\]\.attrs\.href/,
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('capa com endereço perigoso é recusada', async () => {
      await expect(
        service.create(
          { title: 'T', slug: 't', coverImage: 'javascript:alert(1)' },
          USER,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('slug em uso é conflito', async () => {
      prisma.blogArticle.findUnique.mockResolvedValue({ id: 'outro' });

      await expect(
        service.create({ title: 'T', slug: 'chopin' }, USER),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    // No MongoDB não há chave estrangeira: a relação apontaria para o nada.
    it('recusa categoria inexistente', async () => {
      await expect(
        service.create({ title: 'T', slug: 't', categoryIds: [CAT] }, USER),
      ).rejects.toThrow(/Categoria inexistente/);
    });

    // No legado, a segunda relação batia no índice único com o artigo já criado.
    it('tags que dão o mesmo slug viram uma só', async () => {
      await service.create(
        { title: 'T', slug: 't', tags: ['Chopin', 'chopin', ' CHOPIN '] },
        USER,
      );

      expect(prisma.blogTag.create).toHaveBeenCalledTimes(1);
      expect(prisma.blogArticleTag.createMany).toHaveBeenCalledWith({
        data: [{ articleId: ID, tagId: 'tag-chopin' }],
      });
    });

    // O legado somava e subtraía; aqui o contador é refeito das relações.
    it('reconta o uso da tag a partir das relações', async () => {
      prisma.blogArticleTag.count.mockResolvedValue(4);

      await service.create({ title: 'T', slug: 't', tags: ['Chopin'] }, USER);

      expect(prisma.blogTag.update).toHaveBeenCalledWith({
        where: { id: 'tag-chopin' },
        data: { articleCount: 4 },
      });
    });

    // Tag criada ou renomeada no painel com slug que não sai do nome.
    it('acha tag existente pelo nome, sem tentar criar outra', async () => {
      prisma.blogTag.findFirst.mockResolvedValue({ id: 'tag-painel' });

      await service.create({ title: 'T', slug: 't', tags: ['Chopin'] }, USER);

      expect(prisma.blogTag.findFirst.mock.calls[0][0].where).toEqual({
        OR: [{ slug: 'chopin' }, { name: 'Chopin' }],
      });
      expect(prisma.blogTag.create).not.toHaveBeenCalled();
      expect(prisma.blogArticleTag.createMany).toHaveBeenCalledWith({
        data: [{ articleId: ID, tagId: 'tag-painel' }],
      });
    });

    it('recusa tag sem letra nem número', async () => {
      await expect(
        service.create({ title: 'T', slug: 't', tags: ['!!!'] }, USER),
      ).rejects.toThrow(/sem letra nem número/);
    });

    it('recusa agendar para o passado', async () => {
      await expect(
        service.create(
          {
            title: 'T',
            slug: 't',
            status: ArticleStatus.SCHEDULED,
            scheduledFor: '2000-01-01T00:00:00.000Z',
          },
          USER,
        ),
      ).rejects.toThrow(/já passou/);
    });

    it('entra no destaque pela menor posição livre', async () => {
      prisma.blogArticle.findMany.mockResolvedValue([
        { featuredOrder: 1 },
        { featuredOrder: 2 },
      ]);

      await service.create({ title: 'T', slug: 't', isFeatured: true }, USER);

      expect(createData()).toMatchObject({
        isFeatured: true,
        featuredOrder: 3,
      });
    });

    it('respeita o teto de cinco destaques', async () => {
      prisma.blogArticle.findMany.mockResolvedValue(
        [1, 2, 3, 4, 5].map((featuredOrder) => ({ featuredOrder })),
      );

      await expect(
        service.create({ title: 'T', slug: 't', isFeatured: true }, USER),
      ).rejects.toThrow(/Limite de 5/);
    });
  });

  describe('update', () => {
    beforeEach(() => {
      prisma.blogArticle.findUnique.mockResolvedValueOnce(existing);
    });

    it('grava com trava de versão e registra a versão seguinte', async () => {
      await service.update(ID, { title: 'Novo' }, USER);

      expect(updateCall().where).toEqual({ id: ID, version: 3 });
      expect(updateCall().data).toMatchObject({ title: 'Novo', version: 4 });
      expect(
        prisma.blogArticleVersion.create.mock.calls[0][0].data,
      ).toMatchObject({
        version: 4,
        changeLog: 'Atualização do artigo',
      });
    });

    it('edição partindo de versão antiga é recusada', async () => {
      await expect(
        service.update(ID, { title: 'X', expectedVersion: 2 }, USER),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prisma.blogArticle.updateMany).not.toHaveBeenCalled();
    });

    // No legado, a última gravação vencia e a anterior sumia sem aviso.
    it('gravação concorrente no meio é recusada', async () => {
      prisma.blogArticle.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.update(ID, { title: 'X' }, USER)).rejects.toThrow(
        /alterado por outra pessoa/,
      );
    });

    it('trocar as tags reconta também as que saíram', async () => {
      await service.update(ID, { tags: ['Nova'] }, USER);

      const recounted = prisma.blogArticleTag.count.mock.calls.map(
        ([args]: [{ where: { tagId: string } }]) => args.where.tagId,
      );
      expect(recounted).toEqual(
        expect.arrayContaining(['tag-old', 'tag-nova']),
      );
    });

    it('sem tags na requisição, as relações ficam como estão', async () => {
      await service.update(ID, { title: 'X' }, USER);

      expect(prisma.blogArticleTag.deleteMany).not.toHaveBeenCalled();
      expect(prisma.blogArticleCategory.deleteMany).not.toHaveBeenCalled();
    });

    it('republicar não muda a data de publicação', async () => {
      await service.update(ID, { status: ArticleStatus.PUBLISHED }, USER);

      expect(updateCall().data.publishedAt).toBe(yesterday);
    });

    it('agendar sem mudar o estado é recusado', async () => {
      await expect(
        service.update(
          ID,
          { scheduledFor: new Date(Date.now() + 86_400_000).toISOString() },
          USER,
        ),
      ).rejects.toThrow(/status: SCHEDULED/);
    });

    it('conteúdo novo recalcula o tempo de leitura', async () => {
      await service.update(ID, { content: validDoc }, USER);

      expect(updateCall().data).toMatchObject({ estimatedReadTime: 1 });
    });
  });

  it('id malformado é 404, sem consultar o banco', async () => {
    await expect(service.update('xyz', {}, USER)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(prisma.blogArticle.findUnique).not.toHaveBeenCalled();
  });

  it('apagar reconta as tags que o artigo usava', async () => {
    prisma.blogArticle.findUnique.mockResolvedValueOnce(existing);
    prisma.blogArticleTag.count.mockResolvedValue(0);

    await service.remove(ID);

    expect(prisma.blogArticle.delete).toHaveBeenCalledWith({
      where: { id: ID },
    });
    expect(prisma.blogTag.update).toHaveBeenCalledWith({
      where: { id: 'tag-old' },
      data: { articleCount: 0 },
    });
  });

  describe('duplicate', () => {
    const original = {
      id: ID,
      title: 'Chopin',
      slug: 'chopin',
      content: validDoc,
      types: [],
      composerIds: [],
      workIds: [],
      scoreIds: [],
      instrumentIds: [],
      epochIds: [],
      keywords: [],
      categories: [{ categoryId: CAT }],
      tags: [{ tag: { name: 'Chopin' } }],
    };

    it('cria rascunho fora do destaque, com o próximo slug livre', async () => {
      prisma.blogArticle.findUnique.mockResolvedValueOnce(original);
      prisma.blogArticle.findMany.mockResolvedValue([{ slug: 'chopin-copia' }]);

      await service.duplicate(ID, USER);

      expect(createData()).toMatchObject({
        title: 'Chopin (Cópia)',
        slug: 'chopin-copia-1',
        status: ArticleStatus.DRAFT,
        isFeatured: false,
        authorId: USER,
      });
      expect(prisma.blogArticleCategory.createMany).toHaveBeenCalledWith({
        data: [{ articleId: ID, categoryId: CAT }],
      });
    });

    // Duplicar não pode ser o atalho para copiar conteúdo nunca validado.
    it('conteúdo que a política recusa não é copiado', async () => {
      prisma.blogArticle.findUnique.mockResolvedValueOnce({
        ...original,
        content: unsafeDoc,
      });

      await expect(service.duplicate(ID, USER)).rejects.toThrow(
        /corrija-o antes de duplicar/,
      );
    });
  });

  describe('versões', () => {
    it('lista com quem editou', async () => {
      prisma.blogArticle.findUnique.mockResolvedValueOnce(existing);
      prisma.blogArticleVersion.findMany.mockResolvedValue([
        {
          id: 'v',
          version: 2,
          editedBy: USER,
          changeLog: null,
          createdAt: yesterday,
        },
      ]);
      prisma.user.findMany.mockResolvedValue([{ id: USER, firstName: 'Ana' }]);

      const { versions } = await service.listVersions(ID);

      expect(versions[0].editor).toMatchObject({ firstName: 'Ana' });
    });

    it('versão inexistente é 404', async () => {
      await expect(service.getVersion(ID, 9)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    // As versões do legado guardavam o artigo com o autor embutido, sem
    // categorias nem tags.
    it('restaura versão do legado sem mexer em categorias, tags, estado ou slug', async () => {
      prisma.blogArticle.findUnique.mockResolvedValueOnce(existing);
      prisma.blogArticleVersion.findFirst.mockResolvedValue({
        version: 2,
        snapshot: {
          title: 'Antigo',
          slug: 'outro-slug',
          status: 'DRAFT',
          isFeatured: true,
          content: validDoc,
          author: { id: USER },
        },
      });

      await service.restore(ID, 2, USER);

      expect(updateCall().data).toMatchObject({
        title: 'Antigo',
        estimatedReadTime: 1,
        version: 4,
      });
      expect(updateCall().data).not.toHaveProperty('slug');
      expect(updateCall().data).not.toHaveProperty('status');
      expect(updateCall().data).not.toHaveProperty('isFeatured');
      expect(prisma.blogArticleTag.deleteMany).not.toHaveBeenCalled();
      expect(
        prisma.blogArticleVersion.create.mock.calls[0][0].data,
      ).toMatchObject({
        changeLog: 'Restaurado da versão 2',
      });
    });

    it('versão com conteúdo que a política atual recusa não é restaurada', async () => {
      prisma.blogArticle.findUnique.mockResolvedValueOnce(existing);
      prisma.blogArticleVersion.findFirst.mockResolvedValue({
        version: 2,
        snapshot: { content: unsafeDoc },
      });

      await expect(service.restore(ID, 2, USER)).rejects.toThrow(
        /versão 2 tem conteúdo/,
      );
    });
  });
});
