import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ArticleStatus } from '@prisma/client';
import { isMongoId } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { CATEGORY_REF_SELECT } from '../dto/category-ref.dto';
import { ArticleWriterService } from './article-writer.service';
import { CreateArticleDto, UpdateArticleDto } from './dto/write-article.dto';

/** O que o autor (professor) pode deixar como estado: o resto é do admin. */
const ESTADOS_DO_AUTOR: ArticleStatus[] = [
  ArticleStatus.DRAFT,
  ArticleStatus.REVIEW,
];

/**
 * Artigos escritos por professores (01/10).
 *
 * O professor aprovado escreve e edita **os próprios** artigos, e só até
 * eles irem ao ar: rascunho ou "em revisão". Publicar, agendar e pôr em
 * destaque continuam com o administrador, que aprova pelo painel (o estado
 * `REVIEW` e o "Aprovar" já existiam). Pedido de publicar vira revisão.
 *
 * Artigo publicado não volta para o professor editar sozinho: mudar um
 * texto no ar sem revisão é exatamente o que a revisão existe para evitar.
 */
@Injectable()
export class AuthorArticlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: ArticleWriterService,
  ) {}

  /** Os artigos de quem pede, em qualquer estado, do mais mexido ao menos. */
  async listMine(userId: string) {
    const articles = await this.prisma.blogArticle.findMany({
      where: { authorId: userId },
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        coverImage: true,
        status: true,
        publishedAt: true,
        updatedAt: true,
        viewCount: true,
        categories: { select: { category: { select: CATEGORY_REF_SELECT } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return {
      success: true,
      articles: articles.map((a) => ({
        ...a,
        categories: a.categories.map((c) => c.category),
      })),
    };
  }

  create(dto: CreateArticleDto, userId: string) {
    return this.writer.create(comoAutor(dto) as CreateArticleDto, userId);
  }

  async update(id: string, dto: UpdateArticleDto, userId: string) {
    const article = isMongoId(id)
      ? await this.prisma.blogArticle.findUnique({
          where: { id },
          select: { authorId: true, status: true },
        })
      : null;
    if (!article) throw new NotFoundException('Artigo não encontrado');
    if (article.authorId !== userId) {
      throw new ForbiddenException('Este artigo é de outra pessoa');
    }
    if (!ESTADOS_DO_AUTOR.includes(article.status)) {
      throw new ForbiddenException(
        'Artigo publicado ou agendado só muda pelo administrador',
      );
    }
    return this.writer.update(id, comoAutor(dto), userId);
  }
}

/** Tira o que é do administrador; "publicar" vira "mandar para revisão". */
export function comoAutor<T extends UpdateArticleDto>(dto: T): T {
  const {
    isFeatured: _destaque,
    featuredOrder: _posicao,
    scheduledFor: _agenda,
    ...resto
  } = dto;
  void _destaque;
  void _posicao;
  void _agenda;
  const status =
    resto.status === undefined
      ? undefined
      : ESTADOS_DO_AUTOR.includes(resto.status)
        ? resto.status
        : ArticleStatus.REVIEW;
  return { ...resto, ...(status ? { status } : {}) } as T;
}
