import { AppCacheService } from '../../common/cache/cache.service';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ModerationService } from '../../uploads/moderation/moderation.service';
import { CommentsService, REMOVED_PLACEHOLDER } from './comments.service';

const ARTICLE = '690273c1ecac0fb66b3844e7';
const OTHER_ARTICLE = '690273c1ecac0fb66b3844e8';
const C1 = '6a0000000000000000000001';
const C2 = '6a0000000000000000000002';
const C3 = '6a0000000000000000000003';
const USER = '690273c1ecac0fb66b3844bb';
const STRANGER = '690273c1ecac0fb66b3844cc';

const removedAt = new Date(2026, 0, 2);

const published = {
  status: 'PUBLISHED',
  publishedAt: new Date(Date.now() - 60_000),
};

const alive = {
  userId: USER,
  articleId: ARTICLE,
  status: 'APPROVED',
  deletedAt: null,
};

function makePrisma() {
  const prisma = {
    blogArticle: { findUnique: jest.fn().mockResolvedValue(published) },
    blogComment: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(alive),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: C1, ...data }),
      ),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: C1, ...data }),
      ),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    blogCommentLike: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(1),
    },
    $transaction: jest.fn(),
  };

  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) =>
    fn(prisma),
  );

  return prisma;
}

const comment = (
  id: string,
  parentId: string | null,
  minute: number,
  deletedAt: Date | null = null,
) => ({
  id,
  parentId,
  content: `texto de ${id}`,
  createdAt: new Date(2026, 0, 1, 12, minute),
  likeCount: 0,
  status: 'APPROVED',
  deletedAt,
  user: { id: USER, firstName: 'Ana' },
});

describe('CommentsService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let moderation: { report: jest.Mock; closePendingFor: jest.Mock };
  let service: CommentsService;

  beforeEach(() => {
    prisma = makePrisma();
    moderation = {
      report: jest.fn().mockResolvedValue({ id: 'mod-1' }),
      closePendingFor: jest.fn().mockResolvedValue(0),
    };
    service = new CommentsService(
      prisma as unknown as PrismaService,
      moderation as unknown as ModerationService,
      {
        get: jest.fn().mockResolvedValue(undefined),
        set: jest.fn(),
        invalidateMany: jest.fn(),
      } as unknown as AppCacheService,
    );
  });

  describe('list', () => {
    // O legado mostrava os comentários de rascunho para quem tivesse o id.
    it('artigo não publicado é 404 para quem não é administrador', async () => {
      prisma.blogArticle.findUnique.mockResolvedValue({
        status: 'DRAFT',
        publishedAt: null,
      });

      await expect(service.list(ARTICLE, 'newest')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('administrador vê os comentários de rascunho, em todos os estados', async () => {
      prisma.blogArticle.findUnique.mockResolvedValue({
        status: 'DRAFT',
        publishedAt: null,
      });

      await service.list(ARTICLE, 'newest', { sub: STRANGER, role: 2 });

      expect(prisma.blogComment.findMany.mock.calls[0][0].where).toEqual({
        articleId: ARTICLE,
      });
    });

    it('quem lê vê só os comentários no ar', async () => {
      await service.list(ARTICLE, 'newest');

      expect(prisma.blogComment.findMany.mock.calls[0][0].where).toEqual({
        articleId: ARTICLE,
        status: 'APPROVED',
      });
    });

    // Uma consulta de comentários e uma de curtidas, qualquer que seja a árvore.
    it('monta a árvore com uma consulta e marca o que o leitor curtiu', async () => {
      prisma.blogComment.findMany.mockResolvedValue([
        comment(C1, null, 1),
        comment(C2, C1, 2),
        comment(C3, C2, 3),
      ]);
      prisma.blogCommentLike.findMany.mockResolvedValue([{ commentId: C3 }]);

      const result = await service.list(ARTICLE, 'newest', {
        sub: USER,
        role: 0,
      });

      expect(prisma.blogComment.findMany).toHaveBeenCalledTimes(1);
      expect(result.total).toBe(1);
      expect(result.comments[0].replyCount).toBe(1);
      expect(result.comments[0].replies[0].replies[0]).toMatchObject({
        id: C3,
        userLiked: true,
        deleted: false,
      });
    });

    it('comentário removido com respostas aparece como marcador, sem texto nem autor', async () => {
      prisma.blogComment.findMany.mockResolvedValue([
        comment(C1, null, 1, removedAt),
        comment(C2, C1, 2),
      ]);

      const [node] = (await service.list(ARTICLE, 'newest')).comments;

      expect(node).toMatchObject({
        id: C1,
        deleted: true,
        content: REMOVED_PLACEHOLDER,
        user: null,
      });
      expect(node.replies[0]).toMatchObject({
        id: C2,
        content: `texto de ${C2}`,
      });
    });

    // "Comentário removido" sozinho, sem conversa embaixo, não informa nada.
    it('marcador sem resposta visível não aparece', async () => {
      prisma.blogComment.findMany.mockResolvedValue([
        comment(C1, null, 1, removedAt),
        comment(C2, null, 2),
      ]);

      const result = await service.list(ARTICLE, 'newest');

      expect(result.comments.map((node) => node.id)).toEqual([C2]);
      expect(result.total).toBe(1);
    });
  });

  describe('create', () => {
    it('grava o texto normalizado, no ar', async () => {
      await service.create(ARTICLE, USER, {
        content: '  Belo \u202Etexto\u202C  ',
      });

      expect(prisma.blogComment.create.mock.calls[0][0].data).toMatchObject({
        content: 'Belo texto',
        status: 'APPROVED',
        parentId: null,
        userId: USER,
      });
    });

    it('texto curto demais depois de normalizado é recusado', async () => {
      await expect(
        service.create(ARTICLE, USER, { content: ' ab ' }),
      ).rejects.toThrow(/curto/);
    });

    it('não comenta em artigo não publicado', async () => {
      prisma.blogArticle.findUnique.mockResolvedValue({
        status: 'SCHEDULED',
        publishedAt: null,
      });

      await expect(
        service.create(ARTICLE, USER, { content: 'Belo texto' }),
      ).rejects.toThrow(/não publicados/);
    });

    it('resposta a comentário de outro artigo é recusada', async () => {
      prisma.blogComment.findUnique.mockResolvedValue({
        articleId: OTHER_ARTICLE,
        status: 'APPROVED',
        deletedAt: null,
      });

      await expect(
        service.create(ARTICLE, USER, { content: 'Concordo', parentId: C1 }),
      ).rejects.toThrow(/não é deste artigo/);
    });

    // A resposta nasceria invisível embaixo de um comentário fora do ar.
    it('resposta a comentário fora do ar é recusada', async () => {
      prisma.blogComment.findUnique.mockResolvedValue({
        articleId: ARTICLE,
        status: 'REJECTED',
        deletedAt: null,
      });

      await expect(
        service.create(ARTICLE, USER, { content: 'Concordo', parentId: C1 }),
      ).rejects.toThrow(/não está no ar/);
    });

    it('resposta a comentário removido é recusada', async () => {
      prisma.blogComment.findUnique.mockResolvedValue({
        articleId: ARTICLE,
        status: 'APPROVED',
        deletedAt: removedAt,
      });

      await expect(
        service.create(ARTICLE, USER, { content: 'Concordo', parentId: C1 }),
      ).rejects.toThrow(/removido/);
    });
  });

  describe('update', () => {
    it('quem escreveu edita, e o comentário fica marcado como editado', async () => {
      await service.update(C1, USER, { content: 'Texto novo' });

      expect(prisma.blogComment.update.mock.calls[0][0].data).toEqual({
        content: 'Texto novo',
        isEdited: true,
      });
    });

    // O legado deixava o administrador reescrever o texto de qualquer pessoa.
    it('ninguém edita o comentário de outra pessoa', async () => {
      await expect(
        service.update(C1, STRANGER, { content: 'Texto novo' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    // Trocar o texto depois da denúncia mudaria o que o moderador julga.
    it('comentário em análise não é editável', async () => {
      prisma.blogComment.findUnique.mockResolvedValue({
        ...alive,
        status: 'FLAGGED',
      });

      await expect(
        service.update(C1, USER, { content: 'Texto novo' }),
      ).rejects.toThrow(/em análise/);
    });

    it('marcador não é editável', async () => {
      prisma.blogComment.findUnique.mockResolvedValue({
        ...alive,
        deletedAt: removedAt,
      });

      await expect(
        service.update(C1, USER, { content: 'Texto novo' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('texto vazio é recusado', async () => {
      await expect(
        service.update(C1, USER, { content: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('remove', () => {
    // O legado apagava a subárvore: as respostas de outras pessoas iam junto.
    it('com respostas, vira "Comentário removido" e as respostas ficam', async () => {
      prisma.blogComment.findMany.mockResolvedValue([
        { id: C1, parentId: null, deletedAt: null },
        { id: C2, parentId: C1, deletedAt: null },
      ]);

      const result = await service.remove(C1, { sub: USER, role: 0 });

      expect(prisma.blogComment.update).toHaveBeenCalledWith({
        where: { id: C1 },
        data: expect.objectContaining({
          content: '',
          deletedBy: USER,
          likeCount: 0,
        }),
      });
      expect(
        prisma.blogComment.update.mock.calls[0][0].data.deletedAt,
      ).toBeInstanceOf(Date);
      expect(prisma.blogCommentLike.deleteMany).toHaveBeenCalledWith({
        where: { commentId: C1 },
      });
      expect(prisma.blogComment.deleteMany).not.toHaveBeenCalled();
      expect(result).toMatchObject({ placeholder: true, removed: 0 });
    });

    it('sem respostas, é apagado de verdade', async () => {
      prisma.blogComment.findMany.mockResolvedValue([
        { id: C1, parentId: null, deletedAt: null },
        { id: C2, parentId: C1, deletedAt: null },
      ]);

      const result = await service.remove(C2, { sub: USER, role: 0 });

      expect(prisma.blogComment.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.blogComment.deleteMany).toHaveBeenCalledWith({
        where: { id: C2 },
      });
      expect(result).toMatchObject({ placeholder: false, removed: 1 });
    });

    // Um marcador só existe enquanto houver resposta embaixo dele.
    it('apagar a última resposta de um marcador leva o marcador junto', async () => {
      prisma.blogComment.findMany.mockResolvedValue([
        { id: C1, parentId: null, deletedAt: removedAt },
        { id: C2, parentId: C1, deletedAt: null },
      ]);

      const result = await service.remove(C2, { sub: USER, role: 0 });

      expect(
        prisma.blogComment.deleteMany.mock.calls.map(
          ([args]: [{ where: { id: string } }]) => args.where.id,
        ),
      ).toEqual([C2, C1]);
      expect(result.removed).toBe(2);
    });

    it('fecha as denúncias pendentes do que saiu', async () => {
      prisma.blogComment.findMany.mockResolvedValue([
        { id: C1, parentId: null, deletedAt: null },
        { id: C2, parentId: C1, deletedAt: null },
      ]);

      await service.remove(C1, { sub: USER, role: 0 });

      expect(moderation.closePendingFor).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'blog-comment',
          entityId: C1,
          resolution: 'delete',
          notes: 'Comentário apagado por quem escreveu',
        }),
      );
    });

    it('administrador apaga comentário alheio', async () => {
      await expect(
        service.remove(C1, { sub: STRANGER, role: 2 }),
      ).resolves.toMatchObject({ success: true });
    });

    it('outra pessoa não apaga', async () => {
      await expect(
        service.remove(C1, { sub: STRANGER, role: 0 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('marcador já removido é 404', async () => {
      prisma.blogComment.findUnique.mockResolvedValue({
        ...alive,
        deletedAt: removedAt,
      });

      await expect(
        service.remove(C1, { sub: USER, role: 0 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('curtida', () => {
    // No legado, cada chamada somava um.
    it('curtir reconta a partir das curtidas, e não soma', async () => {
      prisma.blogCommentLike.count.mockResolvedValue(1);

      const first = await service.like(C1, USER);
      const second = await service.like(C1, USER);

      expect(first.likeCount).toBe(1);
      expect(second.likeCount).toBe(1);
      expect(prisma.blogComment.update).toHaveBeenLastCalledWith({
        where: { id: C1 },
        data: { likeCount: 1 },
      });
    });

    // No legado, descurtir sem ter curtido levava a contagem a negativo.
    it('descurtir sem ter curtido não fica negativo', async () => {
      prisma.blogCommentLike.count.mockResolvedValue(0);

      const result = await service.unlike(C1, USER);

      expect(result.likeCount).toBe(0);
    });

    it('não curte comentário fora do ar', async () => {
      prisma.blogComment.findUnique.mockResolvedValue({
        ...alive,
        status: 'REJECTED',
      });

      await expect(service.like(C1, USER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('não curte marcador', async () => {
      prisma.blogComment.findUnique.mockResolvedValue({
        ...alive,
        deletedAt: removedAt,
      });

      await expect(service.like(C1, USER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('report', () => {
    const context = { ipAddress: '203.0.113.10', userAgent: 'jest' };

    it('entra na fila de moderação, com categoria', async () => {
      await service.report(
        C1,
        USER,
        { category: 'offensive', reason: 'Conteúdo ofensivo ou impróprio' },
        context,
      );

      expect(moderation.report).toHaveBeenCalledWith(
        USER,
        expect.objectContaining({
          entityType: 'blog-comment',
          entityId: C1,
          category: 'offensive',
        }),
        context,
      );
    });

    // No legado, qualquer denúncia tirava o comentário do ar.
    it('denúncia comum avisa que o comentário continua no ar', async () => {
      const result = await service.report(
        C1,
        USER,
        { category: 'spam', reason: 'Spam ou propaganda' },
        context,
      );

      expect(result.message).toMatch(/continua no ar/);
      expect(prisma.blogComment.update).not.toHaveBeenCalled();
    });

    it('marcador não é denunciável', async () => {
      prisma.blogComment.findUnique.mockResolvedValue({
        ...alive,
        deletedAt: removedAt,
      });

      await expect(
        service.report(C1, USER, { category: 'spam', reason: 'Spam' }, context),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(moderation.report).not.toHaveBeenCalled();
    });

    it('id malformado é 404', async () => {
      await expect(
        service.report(
          'x',
          USER,
          { category: 'spam', reason: 'Spam' },
          context,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
