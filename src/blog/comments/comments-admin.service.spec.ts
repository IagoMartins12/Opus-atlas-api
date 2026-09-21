import { AppCacheService } from '../../common/cache/cache.service';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ModerationService } from '../../uploads/moderation/moderation.service';
import { CommentsAdminService } from './comments-admin.service';

const ARTICLE = '690273c1ecac0fb66b3844e7';
const C1 = '6a0000000000000000000001';
const C2 = '6a0000000000000000000002';
const C3 = '6a0000000000000000000003';
const MOD = '690273c1ecac0fb66b3844dd';

function makePrisma() {
  return {
    blogComment: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ id: C1, articleId: ARTICLE }),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: C1, ...data }),
      ),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    uploadModeration: { groupBy: jest.fn().mockResolvedValue([]) },
  };
}

describe('CommentsAdminService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let moderation: { closePendingFor: jest.Mock };
  let service: CommentsAdminService;

  beforeEach(() => {
    prisma = makePrisma();
    moderation = { closePendingFor: jest.fn().mockResolvedValue(2) };
    service = new CommentsAdminService(
      prisma as unknown as PrismaService,
      moderation as unknown as ModerationService,
      {
        get: jest.fn().mockResolvedValue(undefined),
        set: jest.fn(),
        invalidateMany: jest.fn(),
      } as unknown as AppCacheService,
    );
  });

  describe('moderate', () => {
    // O legado não gravava nem quem moderou nem quando.
    it('aprovar registra quem e quando, e desliga a marca de denúncia', async () => {
      await service.moderate(C1, MOD, { action: 'approve' });

      const data = prisma.blogComment.update.mock.calls[0][0].data;
      expect(data).toMatchObject({
        status: 'APPROVED',
        moderatedBy: MOD,
        isFlagged: false,
      });
      expect(data.moderatedAt).toBeInstanceOf(Date);
    });

    it('reprovar sem justificativa é recusado (RN-4)', async () => {
      await expect(
        service.moderate(C1, MOD, { action: 'reject' }),
      ).rejects.toThrow(/justificativa/);
      expect(prisma.blogComment.update).not.toHaveBeenCalled();
    });

    it('spam não exige justificativa: a marcação é o motivo', async () => {
      await service.moderate(C1, MOD, { action: 'spam' });

      expect(moderation.closePendingFor).toHaveBeenCalledWith(
        expect.objectContaining({
          resolution: 'delete',
          notes: 'Marcado como spam',
        }),
      );
    });

    // Sem isso, a fila cobraria algo já decidido pelo painel.
    it('fecha as denúncias pendentes com a mesma decisão', async () => {
      const result = await service.moderate(C1, MOD, { action: 'approve' });

      expect(moderation.closePendingFor).toHaveBeenCalledWith({
        entityType: 'blog-comment',
        entityId: C1,
        moderatorId: MOD,
        resolution: 'approve',
        notes: null,
      });
      expect(result.reportsClosed).toBe(2);
    });

    it('comentário inexistente é 404', async () => {
      prisma.blogComment.findUnique.mockResolvedValue(null);

      await expect(
        service.moderate(C1, MOD, { action: 'approve' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('list', () => {
    it('filtra por estado e por respostas', async () => {
      await service.list({ status: 'FLAGGED', onlyReplies: true });

      expect(prisma.blogComment.findMany.mock.calls[0][0].where).toEqual({
        status: 'FLAGGED',
        parentId: { not: null },
      });
    });

    it('conta por estado e mostra as denúncias pendentes de cada um', async () => {
      prisma.blogComment.findMany.mockResolvedValue([{ id: C1 }, { id: C2 }]);
      prisma.blogComment.groupBy.mockResolvedValue([
        { status: 'APPROVED', _count: { _all: 7 } },
        { status: 'FLAGGED', _count: { _all: 2 } },
      ]);
      prisma.uploadModeration.groupBy.mockResolvedValue([
        { entityId: C2, _count: { _all: 3 } },
      ]);

      const result = await service.list({});

      expect(result.counts).toMatchObject({
        APPROVED: 7,
        FLAGGED: 2,
        SPAM: 0,
        total: 9,
      });
      expect(result.comments.map((item) => item.pendingReports)).toEqual([
        0, 3,
      ]);
    });
  });

  it('a thread sobe até o topo e desce a conversa inteira', async () => {
    prisma.blogComment.findUnique.mockResolvedValue({
      id: C3,
      articleId: ARTICLE,
    });
    prisma.blogComment.findMany.mockResolvedValue([
      { id: C1, parentId: null, createdAt: new Date(1), likeCount: 0 },
      { id: C2, parentId: C1, createdAt: new Date(2), likeCount: 0 },
      { id: C3, parentId: C2, createdAt: new Date(3), likeCount: 0 },
    ]);

    const { thread } = await service.thread(C3);

    expect(thread.id).toBe(C1);
    expect(thread.replies[0].replies[0].id).toBe(C3);
    expect(prisma.blogComment.findMany).toHaveBeenCalledTimes(1);
  });
});
