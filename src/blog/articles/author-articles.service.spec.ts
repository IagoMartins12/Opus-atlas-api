import { ForbiddenException } from '@nestjs/common';
import { ArticleStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ArticleWriterService } from './article-writer.service';
import { AuthorArticlesService, comoAutor } from './author-articles.service';

const ID = '6a0000000000000000000011';
const EU = '6a0000000000000000000022';

function montar(artigo: { authorId: string; status: ArticleStatus } | null) {
  const prisma = {
    blogArticle: {
      findUnique: jest.fn().mockResolvedValue(artigo),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const writer = {
    create: jest.fn().mockResolvedValue({ success: true }),
    update: jest.fn().mockResolvedValue({ success: true }),
  };
  const service = new AuthorArticlesService(
    prisma as unknown as PrismaService,
    writer as unknown as ArticleWriterService,
  );
  return { service, writer };
}

describe('AuthorArticlesService', () => {
  it('publicar vira revisão, e destaque e agendamento saem', () => {
    expect(
      comoAutor({
        status: ArticleStatus.PUBLISHED,
        isFeatured: true,
        featuredOrder: 1,
        scheduledFor: '2030-01-01',
        title: 'T',
      }),
    ).toEqual({ status: ArticleStatus.REVIEW, title: 'T' });
    expect(comoAutor({ status: ArticleStatus.DRAFT })).toEqual({
      status: ArticleStatus.DRAFT,
    });
  });

  it('edita o próprio rascunho', async () => {
    const { service, writer } = montar({
      authorId: EU,
      status: ArticleStatus.DRAFT,
    });
    await service.update(ID, { title: 'Novo' }, EU);
    expect(writer.update).toHaveBeenCalledWith(ID, { title: 'Novo' }, EU);
  });

  it('não edita artigo de outra pessoa', async () => {
    const { service } = montar({
      authorId: 'outro',
      status: ArticleStatus.DRAFT,
    });
    await expect(service.update(ID, {}, EU)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('não edita artigo já publicado', async () => {
    const { service } = montar({
      authorId: EU,
      status: ArticleStatus.PUBLISHED,
    });
    await expect(service.update(ID, {}, EU)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
