import { Prisma } from '@prisma/client';
import { escapeRegex } from '../../common/utils/regex.util';
import {
  ARTIGOS,
  AUTORES,
  COMPOSITORES,
  DIA,
  DOMINIO,
  compositorPorNome,
  garantirCategoriasETags,
  original,
} from './blog-seed-data';
import type { CatalogJobWork } from './job-types';

/**
 * Semeia o blog com a massa de exemplo: três autores, as categorias e tags e
 * 16 artigos publicados ao longo de dois meses, com capa (o retrato do
 * compositor, do IMSLP), compositores e obras do catálogo, visitas, curtidas e
 * comentários dos leitores que já existem.
 *
 * **Conteúdo de demonstração.** Serve a homologação e ao banco local, não à
 * produção: os autores são fictícios (e-mail `@seed.opusatlas.local`). Rodar
 * de novo apaga os artigos desses autores e recria; os artigos e leitores de
 * verdade nunca são tocados — só perdem o destaque da home, que passa aos da
 * semente.
 */
export const work: CatalogJobWork = async ({
  prisma,
  apply,
  logger,
  progress,
  shouldStop,
}) => {
  // Quem existe no catálogo deste banco, para dizer o que ficaria sem capa.
  const achados = new Map<string, { id: string; portraitUrl: string | null }>();
  for (const nome of COMPOSITORES) {
    const c = await compositorPorNome(prisma, nome);
    if (c) achados.set(nome, c);
  }
  const semCompositor = COMPOSITORES.filter((n) => !achados.has(n));
  const comCapa = [...achados.values()].filter((c) => c.portraitUrl).length;
  const antigos = await prisma.blogArticle.count({
    where: { author: { email: { endsWith: DOMINIO } } },
  });
  logger.log(
    `${ARTIGOS.length} artigos; compositores achados no catálogo: ${achados.size}/${COMPOSITORES.length}, ${comCapa} com retrato`,
  );
  if (semCompositor.length)
    logger.warn(`Sem cadastro neste banco: ${semCompositor.join('; ')}`);
  if (antigos)
    logger.log(`${antigos} artigo(s) de semente anteriores serão recriados`);

  const outcome = {
    summary: {
      artigos: ARTIGOS.length,
      compositoresAchados: achados.size,
      comRetratoDeCapa: comCapa,
      recriados: antigos,
    },
    warnings: semCompositor.length
      ? [`Sem cadastro neste banco: ${semCompositor.join('; ')}`]
      : [],
  };
  if (!apply) return outcome;

  // 1. Categorias e tags
  await garantirCategoriasETags(prisma, true);
  const categorias = new Map(
    (
      await prisma.blogCategory.findMany({ select: { id: true, slug: true } })
    ).map((c) => [c.slug, c.id]),
  );
  const tags = new Map(
    (await prisma.blogTag.findMany({ select: { id: true, slug: true } })).map(
      (t) => [t.slug, t.id],
    ),
  );

  // 2. Autores
  const autores = new Map<string, string>();
  for (const a of AUTORES) {
    const email = `${a.username}${DOMINIO}`;
    const dados = {
      firstName: a.firstName,
      lastName: a.lastName,
      username: a.username,
      bio: a.bio,
      role: 2,
    };
    const user = await prisma.user.upsert({
      where: { email },
      update: dados,
      create: { email, ...dados },
    });
    autores.set(a.chave, user.id);
  }

  // 3. Limpa o que a semeadura criou antes (respostas primeiro: a relação
  // entre comentários não apaga em cascata).
  const ids = (
    await prisma.blogArticle.findMany({
      where: { authorId: { in: [...autores.values()] } },
      select: { id: true },
    })
  ).map((x) => x.id);
  await prisma.blogComment.deleteMany({
    where: { articleId: { in: ids }, parentId: { not: null } },
  });
  await prisma.blogComment.deleteMany({ where: { articleId: { in: ids } } });
  await prisma.blogArticle.deleteMany({ where: { id: { in: ids } } });

  // 4. Artigos. Destaque: os da semente tomam as posições 1 a 3.
  await prisma.blogArticle.updateMany({
    where: { isFeatured: true },
    data: { isFeatured: false, featuredOrder: null },
  });
  const leitores = await prisma.user.findMany({
    where: { email: { not: { endsWith: DOMINIO } } },
    select: { id: true },
    take: 6,
  });

  let feitos = 0;
  for (const a of ARTIGOS) {
    if (shouldStop()) {
      logger.warn('Parada pedida: encerrando.');
      break;
    }
    const compositor = achados.get(a.compositor);
    const obras: string[] = [];
    if (compositor) {
      for (const trecho of a.obras ?? []) {
        const obra = await prisma.work.findFirst({
          where: {
            composerId: compositor.id,
            title: { contains: escapeRegex(trecho), mode: 'insensitive' },
          },
          select: { id: true },
        });
        if (obra) obras.push(obra.id);
      }
    }
    const publicado = new Date(Date.now() - a.dias * DIA - 9 * 3_600_000);
    const capa = original(compositor?.portraitUrl);
    const palavras = JSON.stringify(a.corpo).split(/\s+/).length;

    const artigo = await prisma.blogArticle.create({
      data: {
        title: a.titulo,
        slug: a.slug,
        description: a.resumo,
        content: a.corpo as Prisma.InputJsonValue,
        coverImage: capa,
        coverImageAlt: capa ? `Retrato de ${a.compositor}` : null,
        coverImageCredit: capa ? 'IMSLP, domínio público' : null,
        status: 'PUBLISHED',
        publishedAt: publicado,
        createdAt: publicado,
        isFeatured: Boolean(a.destaque),
        featuredOrder: a.destaque ?? null,
        authorId: autores.get(a.autor)!,
        composerIds: compositor ? [compositor.id] : [],
        workIds: obras,
        viewCount: a.visitas,
        readCount: Math.round(a.visitas * 0.42),
        estimatedReadTime: Math.max(2, Math.round(palavras / 220)),
        backgroundMusicAutoplay: false,
        language: 'pt',
        translation: a.en
          ? ({
              title: a.en.titulo,
              description: a.en.resumo,
              content: a.en.corpo,
            } as Prisma.InputJsonValue)
          : undefined,
        categories: {
          create: a.categorias
            .filter((s) => categorias.has(s))
            .map((s) => ({ categoryId: categorias.get(s)! })),
        },
        tags: {
          create: a.tags
            .filter((s) => tags.has(s))
            .map((s) => ({ tagId: tags.get(s)! })),
        },
      },
    });

    // Curtidas e comentários dos leitores que já existem.
    const quantos = Math.min(leitores.length, Math.round(a.visitas / 800));
    for (const leitor of leitores.slice(0, quantos)) {
      await prisma.blogLike
        .create({ data: { articleId: artigo.id, userId: leitor.id } })
        .catch(() => undefined);
    }
    if (a.visitas > 2000 && leitores.length >= 2) {
      const primeiro = await prisma.blogComment.create({
        data: {
          articleId: artigo.id,
          userId: leitores[0].id,
          content:
            'Que texto bom. Fui ouvir de novo depois de ler e reparei em coisas que nunca tinha notado.',
        },
      });
      await prisma.blogComment.create({
        data: {
          articleId: artigo.id,
          userId: leitores[1].id,
          parentId: primeiro.id,
          content:
            'Aconteceu o mesmo comigo. A lista do que ouvir ajudou muito.',
        },
      });
    }
    feitos++;
    progress(feitos, ARTIGOS.length, a.titulo);
  }

  // 5. Contagem das tags
  for (const id of tags.values()) {
    const n = await prisma.blogArticleTag.count({ where: { tagId: id } });
    await prisma.blogTag.update({ where: { id }, data: { articleCount: n } });
  }

  logger.log(`Blog semeado: ${feitos} artigos`);
  return { ...outcome, summary: { ...outcome.summary, gravados: feitos } };
};
