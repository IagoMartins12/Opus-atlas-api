import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { StorageAssetKind, StorageAssetStatus } from '@prisma/client';
import { existsSync, readFileSync, statSync } from 'fs';
import { basename, join, resolve } from 'path';
import { AppModule } from '../app.module';
import {
  collectMediaUrls,
  replaceMediaUrl,
} from '../blog/articles/content/media-urls';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { errorMessage } from '../common/utils/error.util';

/**
 * Migra para o Cloudinary os arquivos que ainda vivem em disco.
 *
 * Contexto: `profile-image` e `composer-image` do legado gravavam em
 * `public/uploads`, enquanto todo o resto já ia para o Cloudinary. Disco local
 * não sobrevive a um contêiner efêmero nem é compartilhado entre réplicas, então
 * a decisão foi consolidar tudo no Cloudinary e não deixar nada local.
 *
 * **O blog também gravava em disco**: capa, música de fundo, imagem de
 * categoria, galeria e as imagens dentro do conteúdo. As imagens das matérias
 * publicadas moram em `/uploads/blog/_temp/…` — a pasta temporária do
 * formulário, porque o legado nunca as movia nem reescrevia o conteúdo. Este
 * script as leva para o Cloudinary e troca o endereço **dentro do JSON do
 * editor**. O mesmo arquivo, usado em vários lugares, sobe uma vez só.
 *
 * Para cada arquivo: envia ao Cloudinary, cria o registro em `StoredAsset` e
 * reescreve a URL no banco.
 *
 * Uso:
 *   node dist/scripts/migrate-local-uploads.js            # simulação
 *   node dist/scripts/migrate-local-uploads.js --apply    # aplica
 *   node dist/scripts/migrate-local-uploads.js --apply --root=/opt/app/public
 *
 * Roda em simulação por padrão. Nada é gravado sem `--apply`.
 */

interface MigrationCandidate {
  model:
    | 'user'
    | 'composer'
    | 'workScore'
    | 'blogArticle'
    | 'blogArticleContent'
    | 'blogCategory'
    | 'blogMedia';
  recordId: string;
  field: string;
  localUrl: string;
  kind: StorageAssetKind;
  entityType: string;
  /** Dono do arquivo, quando não é o próprio registro (mídia → artigo). */
  entityId?: string;
}

const AUDIO_EXTENSION = /\.(mp3|wav|ogg|m4a|aac)$/i;

function blogKind(url: string): StorageAssetKind {
  return AUDIO_EXTENSION.test(url)
    ? StorageAssetKind.BLOG_AUDIO
    : StorageAssetKind.BLOG_MEDIA;
}

interface Report {
  encontrados: number;
  migrados: number;
  arquivoAusente: number;
  falhas: number;
}

const logger = new Logger('MigrateLocalUploads');

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const rootArg = argv.find((arg) => arg.startsWith('--root='));

  // Por padrão procura em `Classical-Music/public`, que é onde o front do
  // legado grava. Em produção o caminho é outro, daí a opção `--root`.
  const publicRoot = rootArg
    ? rootArg.slice('--root='.length)
    : resolve(process.cwd(), '..', 'Classical-Music', 'public');

  return { apply, publicRoot };
}

/** Só interessa URL local; link externo (IMSLP, Cloudinary) fica de fora. */
function isLocalUrl(url: string | null | undefined): url is string {
  return Boolean(url && url.startsWith('/uploads/'));
}

/** `/uploads/profiles/abc/foto.jpg` → `<root>/uploads/profiles/abc/foto.jpg` */
function toLocalPath(publicRoot: string, url: string): string {
  const relative = url.replace(/^\/+/, '');
  return join(publicRoot, relative);
}

async function collectCandidates(
  prisma: PrismaService,
): Promise<MigrationCandidate[]> {
  const candidates: MigrationCandidate[] = [];

  const users = await prisma.user.findMany({
    where: { image: { contains: '/uploads/' } },
    select: { id: true, image: true },
  });

  for (const user of users) {
    if (isLocalUrl(user.image)) {
      candidates.push({
        model: 'user',
        recordId: user.id,
        field: 'image',
        localUrl: user.image,
        kind: StorageAssetKind.PROFILE_IMAGE,
        entityType: 'user',
      });
    }
  }

  const composers = await prisma.composer.findMany({
    where: { portraitUrl: { contains: '/uploads/' } },
    select: { id: true, portraitUrl: true },
  });

  for (const composer of composers) {
    if (isLocalUrl(composer.portraitUrl)) {
      candidates.push({
        model: 'composer',
        recordId: composer.id,
        field: 'portraitUrl',
        localUrl: composer.portraitUrl,
        kind: StorageAssetKind.COMPOSER_IMAGE,
        entityType: 'composer',
      });
    }
  }

  // `WorkScore.downloadUrl` mistura link do IMSLP (a esmagadora maioria, que
  // não é nosso arquivo) com o punhado que hospedamos. O filtro por
  // `/uploads/` já separa os dois — um link do IMSLP nunca começa assim.
  const scores = await prisma.workScore.findMany({
    where: {
      OR: [
        { downloadUrl: { contains: '/uploads/' } },
        { thumbnailUrl: { contains: '/uploads/' } },
      ],
    },
    select: { id: true, downloadUrl: true, thumbnailUrl: true },
  });

  for (const score of scores) {
    if (isLocalUrl(score.downloadUrl)) {
      candidates.push({
        model: 'workScore',
        recordId: score.id,
        field: 'downloadUrl',
        localUrl: score.downloadUrl,
        kind: StorageAssetKind.SCORE_FILE,
        entityType: 'workScore',
      });
    }

    if (isLocalUrl(score.thumbnailUrl)) {
      candidates.push({
        model: 'workScore',
        recordId: score.id,
        field: 'thumbnailUrl',
        localUrl: score.thumbnailUrl,
        kind: StorageAssetKind.SCORE_THUMBNAIL,
        entityType: 'workScore',
      });
    }
  }

  candidates.push(...(await collectBlogCandidates(prisma)));

  return candidates;
}

async function collectBlogCandidates(
  prisma: PrismaService,
): Promise<MigrationCandidate[]> {
  const candidates: MigrationCandidate[] = [];

  const articles = await prisma.blogArticle.findMany({
    select: {
      id: true,
      coverImage: true,
      backgroundMusicUrl: true,
      content: true,
    },
  });

  for (const article of articles) {
    const base = { recordId: article.id, entityType: 'blogArticle' };

    if (isLocalUrl(article.coverImage)) {
      candidates.push({
        ...base,
        model: 'blogArticle',
        field: 'coverImage',
        localUrl: article.coverImage,
        kind: blogKind(article.coverImage),
      });
    }

    if (isLocalUrl(article.backgroundMusicUrl)) {
      candidates.push({
        ...base,
        model: 'blogArticle',
        field: 'backgroundMusicUrl',
        localUrl: article.backgroundMusicUrl,
        kind: blogKind(article.backgroundMusicUrl),
      });
    }

    for (const url of collectMediaUrls(article.content)) {
      if (isLocalUrl(url)) {
        candidates.push({
          ...base,
          model: 'blogArticleContent',
          field: 'content',
          localUrl: url,
          kind: blogKind(url),
        });
      }
    }
  }

  const categories = await prisma.blogCategory.findMany({
    select: { id: true, image: true, coverImage: true },
  });

  for (const category of categories) {
    for (const field of ['image', 'coverImage'] as const) {
      const url = category[field];

      if (isLocalUrl(url)) {
        candidates.push({
          model: 'blogCategory',
          recordId: category.id,
          field,
          localUrl: url,
          kind: StorageAssetKind.BLOG_MEDIA,
          entityType: 'blogCategory',
        });
      }
    }
  }

  const media = await prisma.blogMedia.findMany({
    select: { id: true, articleId: true, url: true, thumbnailUrl: true },
  });

  for (const item of media) {
    for (const field of ['url', 'thumbnailUrl'] as const) {
      const url = item[field];

      if (isLocalUrl(url)) {
        candidates.push({
          model: 'blogMedia',
          recordId: item.id,
          field,
          localUrl: url,
          kind: blogKind(url),
          entityType: 'blogArticle',
          entityId: item.articleId,
        });
      }
    }
  }

  return candidates;
}

async function applyUrl(
  prisma: PrismaService,
  candidate: MigrationCandidate,
  newUrl: string,
): Promise<void> {
  const data = { [candidate.field]: newUrl };

  switch (candidate.model) {
    case 'user':
      await prisma.user.update({ where: { id: candidate.recordId }, data });
      return;
    case 'composer':
      await prisma.composer.update({ where: { id: candidate.recordId }, data });
      return;
    case 'workScore':
      await prisma.workScore.update({
        where: { id: candidate.recordId },
        data,
      });
      return;
    case 'blogArticle':
      await prisma.blogArticle.update({
        where: { id: candidate.recordId },
        data,
      });
      return;
    case 'blogCategory':
      await prisma.blogCategory.update({
        where: { id: candidate.recordId },
        data,
      });
      return;
    case 'blogMedia':
      await prisma.blogMedia.update({
        where: { id: candidate.recordId },
        data,
      });
      return;
    case 'blogArticleContent': {
      // Relê o conteúdo a cada troca: um artigo com três imagens locais passa
      // por aqui três vezes, e cada troca parte da anterior.
      const article = await prisma.blogArticle.findUniqueOrThrow({
        where: { id: candidate.recordId },
        select: { content: true },
      });
      const { doc } = replaceMediaUrl(
        article.content,
        candidate.localUrl,
        newUrl,
      );

      await prisma.blogArticle.update({
        where: { id: candidate.recordId },
        data: { content: doc as object },
      });
      return;
    }
  }
}

async function main(): Promise<void> {
  const { apply, publicRoot } = parseArgs(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const prisma = app.get(PrismaService);
  const storage = app.get(StorageService);

  // O mesmo arquivo pode estar na capa e no conteúdo, ou em dois artigos:
  // sobe uma vez, e todos os lugares recebem o mesmo endereço novo.
  const uploaded = new Map<string, string>();

  const report: Report = {
    encontrados: 0,
    migrados: 0,
    arquivoAusente: 0,
    falhas: 0,
  };

  try {
    logger.log(`Raiz dos arquivos: ${publicRoot}`);
    logger.log(apply ? 'Modo: APLICAR' : 'Modo: SIMULAÇÃO (use --apply)');

    const candidates = await collectCandidates(prisma);
    report.encontrados = candidates.length;

    if (candidates.length === 0) {
      logger.log('Nenhum arquivo local referenciado no banco. Nada a migrar.');
      return;
    }

    for (const candidate of candidates) {
      const localPath = toLocalPath(publicRoot, candidate.localUrl);
      const label = `${candidate.model}.${candidate.field} (${candidate.recordId})`;

      if (!existsSync(localPath)) {
        report.arquivoAusente++;
        logger.warn(
          `Arquivo ausente em disco, ignorado: ${label} → ${localPath}`,
        );
        continue;
      }

      if (!apply) {
        logger.log(`[simulação] migraria ${label} → ${candidate.localUrl}`);
        report.migrados++;
        continue;
      }

      try {
        let newUrl = uploaded.get(candidate.localUrl);

        if (!newUrl) {
          const buffer = readFileSync(localPath);
          const entityId = candidate.entityId ?? candidate.recordId;
          const asset = await storage.uploadFile(
            {
              kind: candidate.kind,
              scopeId: entityId,
              entityType: candidate.entityType,
              entityId,
            },
            {
              buffer,
              originalName: basename(localPath),
              size: statSync(localPath).size,
            },
          );

          if (asset.status !== StorageAssetStatus.ACTIVE || !asset.secureUrl) {
            throw new Error('Upload não retornou URL definitiva');
          }

          newUrl = asset.secureUrl;
          uploaded.set(candidate.localUrl, newUrl);
        }

        await applyUrl(prisma, candidate, newUrl);

        report.migrados++;
        logger.log(`Migrado ${label} → ${newUrl}`);
      } catch (error: unknown) {
        report.falhas++;
        logger.error(`Falha ao migrar ${label}: ${errorMessage(error)}`);
      }
    }
  } finally {
    logger.log(
      `Resumo — encontrados: ${report.encontrados}, ` +
        `migrados: ${report.migrados}, ` +
        `arquivo ausente: ${report.arquivoAusente}, ` +
        `falhas: ${report.falhas}`,
    );

    await app.close();
  }

  // Falha o processo se algo deu errado, para o operador perceber num deploy.
  process.exit(report.falhas > 0 ? 1 : 0);
}

// O caminho "nada a migrar" volta cedo, antes do `process.exit` do fim; sem
// isto, as conexões da fila e do Redis prendiam o processo.
void main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    logger.error(`Erro fatal: ${errorMessage(error)}`);
    process.exit(1);
  });
