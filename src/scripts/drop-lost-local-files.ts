import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { AppModule } from '../app.module';
import { dropMediaUrls } from '../blog/articles/content/media-urls';
import { AppCacheService } from '../common/cache/cache.service';
import { CATALOG_NAMESPACES, CacheNamespace } from '../common/cache/cache-keys';
import { errorMessage } from '../common/utils/error.util';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Tira do banco as referências a arquivos locais que se perderam.
 *
 * Contexto: o legado gravava parte dos arquivos no disco do servidor do Next
 * (`public/uploads`). O acesso a esse servidor foi perdido em 12/09, e os
 * arquivos com ele — o `storage:migrate-local` não tem o que levar para o
 * Cloudinary. Este script é o outro caminho: tira a referência.
 *
 * **Critério:** endereço `/uploads/…` **e** arquivo ausente na raiz. Arquivo que
 * existe é caso de `storage:migrate-local`, e fica. Se a raiz inteira não
 * existir, o script para: uma `--root` errada faria todo arquivo parecer
 * perdido.
 *
 * **O que acontece com cada um:**
 * - artigo do blog: capa e música de fundo viram `null`; imagem e player de
 *   áudio saem inteiros do conteúdo — e o mesmo nas versões guardadas, senão
 *   restaurar uma versão traria a referência quebrada de volta;
 * - categoria do blog, foto de perfil, retrato de compositor, miniatura de
 *   partitura: o campo vira `null` (o site mostra a imagem padrão);
 * - mídia da galeria do blog sem arquivo: o registro sai;
 * - **partitura sem o PDF: o registro sai** — sem arquivo não há o que baixar.
 *   Antes, quem a escolheu em "quero aprender" ou "já aprendi" perde a
 *   escolha (a obra continua na lista).
 *
 * Uso (com `QUEUE_ROLE=api`, para nenhum worker de fila subir junto):
 *   node dist/scripts/drop-lost-local-files.js            # simulação
 *   node dist/scripts/drop-lost-local-files.js --apply    # aplica
 *   node dist/scripts/drop-lost-local-files.js --apply --root=/opt/app/public
 *
 * Roda em simulação por padrão. Nada é gravado sem `--apply`.
 */

const logger = new Logger('DropLostLocalFiles');

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const rootArg = argv.find((arg) => arg.startsWith('--root='));
  const publicRoot = rootArg
    ? rootArg.slice('--root='.length)
    : resolve(process.cwd(), '..', 'Classical-Music', 'public');

  return { apply, publicRoot };
}

const LOCAL = { startsWith: '/uploads/' };

interface Report {
  files: Set<string>;
  changes: number;
}

async function main(): Promise<void> {
  const { apply, publicRoot } = parseArgs(process.argv.slice(2));

  if (!existsSync(publicRoot)) {
    logger.error(
      `A raiz ${publicRoot} não existe. Sem ela, todo arquivo pareceria perdido — confira o --root.`,
    );
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const prisma = app.get(PrismaService);
  const cache = app.get(AppCacheService);

  const isLost = (url: unknown): url is string =>
    typeof url === 'string' &&
    url.startsWith('/uploads/') &&
    !existsSync(join(publicRoot, url.replace(/^\/+/, '')));

  const report: Report = { files: new Set(), changes: 0 };

  /** Registra e, com `--apply`, grava. */
  const change = async (
    label: string,
    urls: string[],
    write: () => Promise<unknown>,
  ): Promise<void> => {
    urls.forEach((url) => report.files.add(url));
    report.changes++;
    logger.log(`${apply ? 'Feito' : '[simulação]'}: ${label}`);

    if (apply) {
      await write();
    }
  };

  try {
    logger.log(`Raiz dos arquivos: ${publicRoot}`);
    logger.log(apply ? 'Modo: APLICAR' : 'Modo: SIMULAÇÃO (use --apply)');

    // ----- Artigos do blog e versões ---------------------------------------
    const cleanArticle = (source: Record<string, unknown>) => {
      const data: Record<string, unknown> = {};
      const dropped: string[] = [];

      for (const field of ['coverImage', 'backgroundMusicUrl']) {
        if (isLost(source[field])) {
          dropped.push(source[field]);
          data[field] = null;
        }
      }

      if (source.content !== undefined && source.content !== null) {
        const result = dropMediaUrls(source.content, isLost);

        if (result.dropped.length > 0) {
          data.content = result.doc;
          dropped.push(...result.dropped);
        }
      }

      return { data, dropped };
    };

    const articles = await prisma.blogArticle.findMany({
      select: {
        id: true,
        title: true,
        coverImage: true,
        backgroundMusicUrl: true,
        content: true,
      },
    });

    for (const article of articles) {
      const { data, dropped } = cleanArticle(article);

      if (dropped.length > 0) {
        await change(
          `artigo "${article.title}" — ${dropped.length} referência(s)`,
          dropped,
          () =>
            prisma.blogArticle.update({
              where: { id: article.id },
              data: data as Prisma.BlogArticleUpdateInput,
            }),
        );
      }
    }

    const versions = await prisma.blogArticleVersion.findMany({
      select: { id: true, articleId: true, version: true, snapshot: true },
    });

    for (const version of versions) {
      const snapshot = version.snapshot as Record<string, unknown> | null;

      if (!snapshot || typeof snapshot !== 'object') {
        continue;
      }

      const { data, dropped } = cleanArticle(snapshot);

      if (dropped.length > 0) {
        await change(
          `versão ${version.version} do artigo ${version.articleId} — ${dropped.length} referência(s)`,
          dropped,
          () =>
            prisma.blogArticleVersion.update({
              where: { id: version.id },
              data: {
                snapshot: { ...snapshot, ...data } as Prisma.InputJsonValue,
              },
            }),
        );
      }
    }

    // ----- Categorias e galeria do blog ------------------------------------
    const categories = await prisma.blogCategory.findMany({
      where: { OR: [{ image: LOCAL }, { coverImage: LOCAL }] },
      select: { id: true, name: true, image: true, coverImage: true },
    });

    for (const category of categories) {
      const data: Prisma.BlogCategoryUpdateInput = {};
      const dropped: string[] = [];

      if (isLost(category.image)) {
        data.image = null;
        dropped.push(category.image);
      }

      if (isLost(category.coverImage)) {
        data.coverImage = null;
        dropped.push(category.coverImage);
      }

      if (dropped.length > 0) {
        await change(`imagem da categoria "${category.name}"`, dropped, () =>
          prisma.blogCategory.update({ where: { id: category.id }, data }),
        );
      }
    }

    const media = await prisma.blogMedia.findMany({
      where: { OR: [{ url: LOCAL }, { thumbnailUrl: LOCAL }] },
      select: { id: true, url: true, thumbnailUrl: true },
    });

    for (const item of media) {
      if (isLost(item.url)) {
        await change(
          `mídia ${item.id} da galeria do blog (sai)`,
          [item.url],
          () => prisma.blogMedia.delete({ where: { id: item.id } }),
        );
      } else if (isLost(item.thumbnailUrl)) {
        await change(`miniatura da mídia ${item.id}`, [item.thumbnailUrl], () =>
          prisma.blogMedia.update({
            where: { id: item.id },
            data: { thumbnailUrl: null },
          }),
        );
      }
    }

    // ----- Fotos de perfil e retratos de compositor ------------------------
    const users = await prisma.user.findMany({
      where: { image: LOCAL },
      select: { id: true, image: true },
    });

    for (const user of users) {
      if (isLost(user.image)) {
        await change(`foto de perfil do usuário ${user.id}`, [user.image], () =>
          prisma.user.update({ where: { id: user.id }, data: { image: null } }),
        );
      }
    }

    const composers = await prisma.composer.findMany({
      where: { portraitUrl: LOCAL },
      select: { id: true, name: true, portraitUrl: true },
    });

    for (const composer of composers) {
      if (isLost(composer.portraitUrl)) {
        await change(
          `retrato do compositor "${composer.name}"`,
          [composer.portraitUrl],
          () =>
            prisma.composer.update({
              where: { id: composer.id },
              data: { portraitUrl: null },
            }),
        );
      }
    }

    // ----- Partituras -------------------------------------------------------
    const scores = await prisma.workScore.findMany({
      where: { OR: [{ downloadUrl: LOCAL }, { thumbnailUrl: LOCAL }] },
      select: { id: true, title: true, downloadUrl: true, thumbnailUrl: true },
    });

    for (const score of scores) {
      if (isLost(score.downloadUrl)) {
        const urls = [score.downloadUrl];

        if (isLost(score.thumbnailUrl)) {
          urls.push(score.thumbnailUrl);
        }

        await change(`partitura "${score.title}" ${score.id} (sai)`, urls, () =>
          prisma.$transaction([
            prisma.wantToLearn.updateMany({
              where: { selectedWorkScoreId: score.id },
              data: { selectedWorkScoreId: null },
            }),
            prisma.learned.updateMany({
              where: { selectedWorkScoreId: score.id },
              data: { selectedWorkScoreId: null },
            }),
            prisma.workScore.delete({ where: { id: score.id } }),
          ]),
        );
      } else if (isLost(score.thumbnailUrl)) {
        await change(
          `miniatura da partitura "${score.title}"`,
          [score.thumbnailUrl],
          () =>
            prisma.workScore.update({
              where: { id: score.id },
              data: { thumbnailUrl: null },
            }),
        );
      }
    }

    // Blog, catálogo e diretório de professores mostram estes dados, com cache.
    if (apply && report.changes > 0) {
      await cache.invalidateMany([
        CacheNamespace.BLOG_ARTICLES,
        CacheNamespace.BLOG_CATEGORIES,
        CacheNamespace.TEACHERS,
        ...CATALOG_NAMESPACES,
      ]);
    }
  } catch (error: unknown) {
    logger.error(`Falha: ${errorMessage(error)}`);
    process.exitCode = 1;
  } finally {
    logger.log(
      `Resumo — arquivos perdidos: ${report.files.size}, alterações: ${report.changes}`,
    );

    await app.close();
  }

  // As conexões da fila e do Redis prendem o processo; sai explicitamente.
  process.exit(process.exitCode ?? 0);
}

void main().catch((error: unknown) => {
  logger.error(`Erro fatal: ${errorMessage(error)}`);
  process.exit(1);
});
