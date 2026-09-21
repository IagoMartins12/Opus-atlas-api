import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ArticleStatus, CommentStatus, Prisma } from '@prisma/client';
import { isMongoId } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace } from '../../common/cache/cache-keys';
import { ModerationService } from '../../uploads/moderation/moderation.service';
import { isGrave } from '../../uploads/moderation/report-categories';
import { RequestContext } from '../../uploads/shared/upload-history.service';
import { AUTHOR_SELECT } from '../dto/author-ref.dto';
import { commentLengthError, normalizeCommentText } from './comment-text';
import {
  buildCommentTree,
  CommentSort,
  removalChain,
  WithReplies,
} from './comment-tree';
import {
  CreateCommentDto,
  ReportCommentDto,
  UpdateCommentDto,
} from './dto/comment.dto';

/** Como o comentário aparece na fila de moderação (`UploadModeration`). */
export const COMMENT_ENTITY = 'blog-comment' as const;

/** Teto de comentários carregados de um artigo numa leitura. */
export const MAX_COMMENTS_PER_ARTICLE = 2000;

/** O que aparece no lugar de um comentário apagado que tinha respostas. */
export const REMOVED_PLACEHOLDER = 'Comentário removido';

const ROLE_ADMIN = 1;

/** Estados em que quem escreveu ainda pode mexer no texto. */
const EDITABLE = new Set<CommentStatus>([
  CommentStatus.APPROVED,
  CommentStatus.PENDING,
]);

const LIST_INCLUDE = { user: { select: AUTHOR_SELECT } } as const;

type ListedComment = Prisma.BlogCommentGetPayload<{
  include: typeof LIST_INCLUDE;
}>;

type Presented = Omit<ListedComment, 'content' | 'user'> & {
  content: string;
  user: ListedComment['user'] | null;
  /** Verdadeiro no marcador "Comentário removido". */
  deleted: boolean;
  userLiked: boolean;
  replyCount: number;
  replies: Presented[];
};

interface Viewer {
  sub: string;
  role: number;
}

/**
 * Comentários do blog, do lado de quem lê e escreve.
 *
 * **Comentário nasce no ar** (`APPROVED`), como no legado e como a regra de
 * moderação manda (RN-4): denúncia é sinal, não sentença, e o que não foi
 * julgado fica onde está. O que mudou é o que acontece depois da denúncia —
 * ver `report` — e ao apagar — ver `remove`.
 */
@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    private readonly cache: AppCacheService,
  ) {}

  /** O detalhe do artigo mostra quantos comentários ele tem. */
  private async invalidate(): Promise<void> {
    await this.cache.invalidateMany([CacheNamespace.BLOG_ARTICLES]);
  }

  /**
   * Comentários de um artigo, em árvore.
   *
   * **Uma consulta só**, e a árvore montada em memória — o legado fazia uma por
   * comentário, recursivamente. E **só de artigo publicado**: o legado conferia
   * que o artigo existia, mas não o estado dele, e os comentários de um
   * rascunho saíam para quem tivesse o id.
   *
   * O comentário apagado que tinha respostas aparece como "Comentário
   * removido", sem texto e sem autor; se nenhuma resposta dele estiver visível,
   * ele não aparece.
   */
  async list(articleId: string, sort: CommentSort, viewer?: Viewer) {
    const isAdmin = !!viewer && viewer.role >= ROLE_ADMIN;
    const article = await this.findArticle(articleId);

    if (!article || (!isAdmin && !isPublished(article))) {
      throw new NotFoundException('Artigo não encontrado');
    }

    const comments = await this.prisma.blogComment.findMany({
      where: {
        articleId,
        ...(isAdmin ? {} : { status: CommentStatus.APPROVED }),
      },
      include: LIST_INCLUDE,
      orderBy: { createdAt: 'asc' },
      take: MAX_COMMENTS_PER_ARTICLE,
    });

    const liked = new Set<string>();

    if (viewer && comments.length > 0) {
      const likes = await this.prisma.blogCommentLike.findMany({
        where: {
          userId: viewer.sub,
          commentId: { in: comments.map((comment) => comment.id) },
        },
        select: { commentId: true },
      });

      likes.forEach((like) => liked.add(like.commentId));
    }

    const presented = buildCommentTree(comments, sort)
      .map((node) => present(node, liked))
      .filter((node): node is Presented => node !== null);

    return { success: true, comments: presented, total: presented.length };
  }

  async create(articleId: string, userId: string, dto: CreateCommentDto) {
    const content = cleanText(dto.content);
    const article = await this.findArticle(articleId);

    if (!article) {
      throw new NotFoundException('Artigo não encontrado');
    }

    if (!isPublished(article)) {
      throw new BadRequestException(
        'Não é possível comentar em artigos não publicados',
      );
    }

    if (dto.parentId) {
      const parent = await this.prisma.blogComment.findUnique({
        where: { id: dto.parentId },
        select: { articleId: true, status: true, deletedAt: true },
      });

      if (!parent) {
        throw new NotFoundException('Comentário respondido não encontrado');
      }

      if (parent.articleId !== articleId) {
        throw new BadRequestException(
          'O comentário respondido não é deste artigo',
        );
      }

      if (parent.deletedAt) {
        throw new BadRequestException(
          'Não dá para responder a um comentário removido',
        );
      }

      // O legado aceitava resposta a comentário reprovado: ela nascia
      // invisível, porque a leitura esconde o que está embaixo de um
      // comentário fora do ar.
      if (parent.status !== CommentStatus.APPROVED) {
        throw new BadRequestException(
          'Não dá para responder a um comentário que não está no ar',
        );
      }
    }

    const comment = await this.prisma.blogComment.create({
      data: {
        articleId,
        userId,
        content,
        parentId: dto.parentId ?? null,
        status: CommentStatus.APPROVED,
      },
      include: LIST_INCLUDE,
    });

    await this.invalidate();

    return { success: true, comment, message: 'Comentário publicado' };
  }

  /**
   * Edita o próprio comentário.
   *
   * **Só quem escreveu edita.** O legado deixava o administrador reescrever o
   * comentário de qualquer pessoa — e o texto continuava assinado por ela. A
   * moderação reprova, marca como spam ou tira do ar; não põe palavras na boca
   * de ninguém.
   *
   * **Comentário em análise ou fora do ar não é editável.** Sem isso, quem foi
   * denunciado trocaria o texto depois da denúncia, e o moderador julgaria uma
   * coisa diferente da que foi denunciada.
   */
  async update(id: string, userId: string, dto: UpdateCommentDto) {
    const current = await this.requireComment(id);

    if (current.userId !== userId) {
      throw new ForbiddenException('Só quem escreveu pode editar o comentário');
    }

    if (!EDITABLE.has(current.status)) {
      throw new BadRequestException(
        'Este comentário está em análise ou saiu do ar, e não pode ser editado',
      );
    }

    const comment = await this.prisma.blogComment.update({
      where: { id },
      data: { content: cleanText(dto.content), isEdited: true },
      include: LIST_INCLUDE,
    });

    return { success: true, comment, message: 'Comentário atualizado' };
  }

  /**
   * Apaga um comentário.
   *
   * **Com respostas, fica "Comentário removido" no lugar.** O legado apagava a
   * subárvore inteira: quem apagava o próprio comentário levava junto as
   * respostas de outras pessoas, que nunca pediram para sair. Agora o texto é
   * apagado — quem apaga quer as palavras fora — e o comentário vira um
   * marcador, para a conversa de quem respondeu continuar fazendo sentido.
   *
   * **Sem respostas, sai de verdade**, e leva junto os marcadores acima dele
   * que ficaram sem resposta nenhuma (`removalChain`).
   *
   * Nos dois casos as denúncias pendentes são fechadas; sem isso, ficariam na
   * fila apontando para um texto que não existe mais.
   */
  async remove(id: string, user: Viewer) {
    const current = await this.requireComment(id);
    const isOwner = current.userId === user.sub;

    if (!isOwner && user.role < ROLE_ADMIN) {
      throw new ForbiddenException(
        'Você não tem permissão para apagar este comentário',
      );
    }

    const all = await this.prisma.blogComment.findMany({
      where: { articleId: current.articleId },
      select: { id: true, parentId: true, deletedAt: true },
    });

    const notes = isOwner
      ? 'Comentário apagado por quem escreveu'
      : 'Comentário apagado pela administração';

    if (all.some((comment) => comment.parentId === id)) {
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.blogCommentLike.deleteMany({ where: { commentId: id } });
        await tx.blogComment.update({
          where: { id },
          data: {
            content: '',
            deletedAt: new Date(),
            deletedBy: user.sub,
            likeCount: 0,
          },
        });
      });

      await this.closeReports([id], user.sub, notes);
      await this.invalidate();

      return {
        success: true,
        placeholder: true,
        removed: 0,
        message: 'Comentário removido. As respostas continuam na conversa.',
      };
    }

    const doomed = removalChain(all, id);

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const commentId of doomed) {
        await tx.blogCommentLike.deleteMany({ where: { commentId } });
        await tx.blogComment.deleteMany({ where: { id: commentId } });
      }
    });

    await this.closeReports(doomed, user.sub, notes);
    await this.invalidate();

    return {
      success: true,
      placeholder: false,
      removed: doomed.length,
      message: 'Comentário apagado',
    };
  }

  /**
   * Curte um comentário — **quantas vezes quiser, conta uma.**
   *
   * O legado fazia `upsert` da curtida, que é idempotente, e em seguida
   * **sempre** `likeCount + 1`. Curtir o mesmo comentário mil vezes somava mil.
   * A resposta mostrava a contagem real, mas a ordenação "mais curtidos" usava
   * o campo inflado — qualquer um punha o próprio comentário no topo. E
   * descurtir sem ter curtido descontava, levando a contagem a negativo.
   * Aqui o número é recontado das curtidas, na mesma transação.
   */
  async like(id: string, userId: string) {
    const current = await this.requireComment(id);

    if (current.status !== CommentStatus.APPROVED) {
      throw new NotFoundException('Comentário não encontrado');
    }

    const likeCount = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        await tx.blogCommentLike.upsert({
          where: { commentId_userId: { commentId: id, userId } },
          create: { commentId: id, userId },
          update: {},
        });

        return recount(tx, id);
      },
    );

    return { success: true, liked: true, likeCount };
  }

  async unlike(id: string, userId: string) {
    await this.requireComment(id);

    const likeCount = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        await tx.blogCommentLike.deleteMany({
          where: { commentId: id, userId },
        });

        return recount(tx, id);
      },
    );

    return { success: true, liked: false, likeCount };
  }

  /**
   * Denuncia um comentário — na fila de moderação da plataforma (RN-4).
   *
   * **No legado, uma denúncia tirava o comentário do ar.** A rota gravava
   * `status: FLAGGED`, e a leitura pública só mostra `APPROVED`: qualquer
   * usuário autenticado sumia com qualquer comentário num clique. E como o
   * comentário só tem lugar para um denunciante, a segunda denúncia apagava o
   * motivo da primeira.
   *
   * Agora cada denúncia é uma linha na fila de moderação, com categoria,
   * prioridade e prazo, e a mesma pessoa não denuncia o mesmo comentário duas
   * vezes. **O comentário continua no ar** até alguém julgar — salvo categoria
   * grave (direito autoral, conteúdo ilegal), que o tira do ar na hora e avisa
   * quem escreveu.
   */
  async report(
    id: string,
    userId: string,
    dto: ReportCommentDto,
    context: RequestContext,
  ) {
    // Marcador não tem texto: não há o que denunciar.
    await this.requireComment(id);

    const report = await this.moderation.report(
      userId,
      {
        entityType: COMMENT_ENTITY,
        entityId: id,
        category: dto.category,
        reason: dto.reason.trim(),
        description: dto.description,
      },
      context,
    );

    return {
      success: true,
      reportId: report.id,
      message: isGrave(dto.category)
        ? 'Denúncia registrada. O comentário saiu do ar enquanto a equipe analisa.'
        : 'Denúncia registrada. O comentário continua no ar até a análise.',
    };
  }

  // -------------------------------------------------------------------

  private async findArticle(id: string) {
    if (!isMongoId(id)) {
      return null;
    }

    return this.prisma.blogArticle.findUnique({
      where: { id },
      select: { status: true, publishedAt: true },
    });
  }

  /** O comentário, desde que exista e não seja um marcador. */
  private async requireComment(id: string) {
    if (!isMongoId(id)) {
      throw new NotFoundException('Comentário não encontrado');
    }

    const comment = await this.prisma.blogComment.findUnique({
      where: { id },
      select: { userId: true, articleId: true, status: true, deletedAt: true },
    });

    if (!comment || comment.deletedAt) {
      throw new NotFoundException('Comentário não encontrado');
    }

    return comment;
  }

  private async closeReports(
    ids: string[],
    moderatorId: string,
    notes: string,
  ): Promise<void> {
    for (const entityId of ids) {
      await this.moderation.closePendingFor({
        entityType: COMMENT_ENTITY,
        entityId,
        moderatorId,
        resolution: 'delete',
        notes,
      });
    }
  }
}

function isPublished(article: {
  status: ArticleStatus;
  publishedAt: Date | null;
}): boolean {
  return (
    article.status === ArticleStatus.PUBLISHED &&
    !!article.publishedAt &&
    article.publishedAt.getTime() <= Date.now()
  );
}

function cleanText(raw: string): string {
  const text = normalizeCommentText(raw);
  const error = commentLengthError(text);

  if (error) {
    throw new BadRequestException(error);
  }

  return text;
}

async function recount(
  tx: Prisma.TransactionClient,
  commentId: string,
): Promise<number> {
  const likeCount = await tx.blogCommentLike.count({ where: { commentId } });

  await tx.blogComment.update({
    where: { id: commentId },
    data: { likeCount },
  });

  return likeCount;
}

/**
 * Um nó da árvore como sai para o leitor.
 *
 * Marcador sem resposta visível vira `null` e some — "Comentário removido"
 * sozinho, sem conversa embaixo, não informa nada.
 */
function present(
  node: WithReplies<ListedComment>,
  liked: ReadonlySet<string>,
): Presented | null {
  const replies = node.replies
    .map((reply) => present(reply, liked))
    .filter((reply): reply is Presented => reply !== null);

  const deleted = !!node.deletedAt;

  if (deleted && replies.length === 0) {
    return null;
  }

  return {
    ...node,
    content: deleted ? REMOVED_PLACEHOLDER : node.content,
    user: deleted ? null : node.user,
    deleted,
    userLiked: !deleted && liked.has(node.id),
    replyCount: replies.length,
    replies,
  };
}
