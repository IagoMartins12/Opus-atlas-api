import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CommentStatus, Prisma } from '@prisma/client';
import { isMongoId } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace } from '../../common/cache/cache-keys';
import { ModerationService } from '../../uploads/moderation/moderation.service';
import { AUTHOR_SELECT } from '../dto/author-ref.dto';
import { buildCommentTree, rootOf } from './comment-tree';
import { COMMENT_ENTITY, MAX_COMMENTS_PER_ARTICLE } from './comments.service';
import {
  AdminCommentsQueryDto,
  CommentModerationAction,
  ModerateCommentDto,
} from './dto/comment.dto';

const STATUS_OF: Record<CommentModerationAction, CommentStatus> = {
  approve: CommentStatus.APPROVED,
  reject: CommentStatus.REJECTED,
  spam: CommentStatus.SPAM,
};

/** O painel vê o e-mail de quem comentou; a leitura pública, não. */
const ADMIN_USER_SELECT = { ...AUTHOR_SELECT, email: true } as const;

/**
 * Painel de moderação de comentários.
 *
 * Convive com a fila de denúncias da plataforma: a fila trata **denúncia**
 * (com prazo), o painel trata **estado do comentário**. Quando o painel
 * decide, as denúncias pendentes daquele comentário são fechadas com a mesma
 * decisão — senão a fila continuaria cobrando algo já resolvido.
 */
@Injectable()
export class CommentsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    private readonly cache: AppCacheService,
  ) {}

  /** O detalhe do artigo mostra quantos comentários ele tem. */
  private async invalidate(): Promise<void> {
    await this.cache.invalidateMany([CacheNamespace.BLOG_ARTICLES]);
  }

  async list(query: AdminCommentsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const where: Prisma.BlogCommentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.onlyReplies ? { parentId: { not: null } } : {}),
    };

    const [comments, total, byStatus, replies] = await Promise.all([
      this.prisma.blogComment.findMany({
        where,
        include: {
          user: { select: ADMIN_USER_SELECT },
          article: { select: { id: true, title: true, slug: true } },
          _count: { select: { likes: true, replies: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.blogComment.count({ where }),
      this.prisma.blogComment.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.blogComment.count({ where: { parentId: { not: null } } }),
    ]);

    // O legado mostrava o motivo da última denúncia (`flagReason`). Agora
    // cada denúncia é uma linha da fila; o painel mostra quantas estão
    // pendentes, e o detalhe mora na fila.
    const pending =
      comments.length > 0
        ? await this.prisma.uploadModeration.groupBy({
            by: ['entityId'],
            where: {
              entityType: COMMENT_ENTITY,
              status: 'pending',
              entityId: { in: comments.map((comment) => comment.id) },
            },
            _count: { _all: true },
          })
        : [];
    const pendingById = new Map(
      pending.map((row) => [row.entityId, row._count._all]),
    );

    const counts: Record<string, number> = Object.fromEntries(
      Object.values(CommentStatus).map((status) => [status, 0]),
    );

    for (const row of byStatus) {
      counts[row.status] = row._count._all;
    }

    counts.total = Object.values(CommentStatus).reduce(
      (sum, status) => sum + counts[status],
      0,
    );
    counts.replies = replies;

    return {
      success: true,
      comments: comments.map((comment) => ({
        ...comment,
        pendingReports: pendingById.get(comment.id) ?? 0,
      })),
      counts,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Muda o estado de um comentário.
   *
   * **O legado não registrava quem moderou nem quando**, embora o modelo
   * tenha os dois campos (`moderatedBy`, `moderatedAt`), e deixava
   * `isFlagged` ligado depois de aprovado.
   *
   * **Reprovar exige justificativa** (RN-4): tirar do ar o que alguém escreveu
   * sem uma linha dizendo por quê deixa a pessoa sem o que responder. Spam não
   * exige — a marcação já é o motivo.
   */
  async moderate(id: string, moderatorId: string, dto: ModerateCommentDto) {
    await this.requireComment(id);

    const notes = dto.notes?.trim() || null;

    if (dto.action === 'reject' && !notes) {
      throw new BadRequestException(
        'Reprovar um comentário exige uma justificativa em `notes` (RN-4).',
      );
    }

    const comment = await this.prisma.blogComment.update({
      where: { id },
      data: {
        status: STATUS_OF[dto.action],
        moderatedBy: moderatorId,
        moderatedAt: new Date(),
        isFlagged: false,
      },
    });

    const reportsClosed = await this.moderation.closePendingFor({
      entityType: COMMENT_ENTITY,
      entityId: id,
      moderatorId,
      resolution: dto.action === 'approve' ? 'approve' : 'delete',
      notes: notes ?? (dto.action === 'spam' ? 'Marcado como spam' : null),
    });

    await this.invalidate();

    return { success: true, comment, reportsClosed };
  }

  /**
   * A conversa inteira em que um comentário está, a partir do topo.
   *
   * Uma consulta com todos os comentários do artigo e a árvore em memória. O
   * legado subia até a raiz uma consulta por ancestral, e descia uma por
   * resposta.
   */
  async thread(id: string) {
    const target = await this.requireComment(id);

    const all = await this.prisma.blogComment.findMany({
      where: { articleId: target.articleId },
      include: {
        user: { select: ADMIN_USER_SELECT },
        _count: { select: { likes: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_COMMENTS_PER_ARTICLE,
    });

    const rootId = rootOf(all, id);

    // A raiz vira topo mesmo que o pai dela tenha sido apagado: é a conversa
    // que o moderador pediu para ver.
    const thread =
      buildCommentTree(
        all.map((comment) =>
          comment.id === rootId ? { ...comment, parentId: null } : comment,
        ),
        'oldest',
      ).find((node) => node.id === rootId) ?? null;

    if (!thread) {
      throw new NotFoundException('Conversa não encontrada');
    }

    return { success: true, thread };
  }

  private async requireComment(id: string) {
    if (!isMongoId(id)) {
      throw new NotFoundException('Comentário não encontrado');
    }

    const comment = await this.prisma.blogComment.findUnique({
      where: { id },
      select: { id: true, articleId: true },
    });

    if (!comment) {
      throw new NotFoundException('Comentário não encontrado');
    }

    return comment;
  }
}
