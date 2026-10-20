import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { CollectionKind } from '@prisma/client';
import { AppModule } from '../app.module';
import { CacheNamespace } from '../common/cache/cache-keys';
import { AppCacheService } from '../common/cache/cache.service';
import { errorMessage } from '../common/utils/error.util';
import { PrismaService } from '../prisma/prisma.service';

/** The editorial account that signs the team's collections. It cannot sign in. */
const TEAM = {
  email: 'equipe@opusatlas.com.br',
  firstName: 'Equipe',
  lastName: 'Opus Atlas',
};

/** A composer by full name; a work by its composer and exact title. */
type Ref =
  | { composer: string; note?: string }
  | { composer: string; work: string; note?: string }
  | { composer: string; work: string; scores: number; note?: string };

interface Seed {
  title: string;
  description: string;
  kind: CollectionKind;
  featured?: boolean;
  items: Ref[];
}

const SEEDS: Seed[] = [
  {
    title: 'Para começar a ouvir',
    description:
      'Seis nomes que abrem quase qualquer porta da música clássica. Comece por qualquer um.',
    kind: 'COMPOSER',
    featured: true,
    items: [
      { composer: 'Johann Sebastian Bach', note: 'A régua de todo o resto.' },
      { composer: 'Wolfgang Amadeus Mozart' },
      {
        composer: 'Ludwig van Beethoven',
        note: 'Ouça uma sinfonia inteira, sem pular.',
      },
      { composer: 'Frédéric Chopin' },
      { composer: 'Pyotr Tchaikovsky' },
      {
        composer: 'Claude Debussy',
        note: 'Para quando o ouvido já pedir cor.',
      },
    ],
  },
  {
    title: 'Mulheres que compuseram',
    description:
      'Da abadia medieval aos salões de Paris: obras que a história demorou a contar.',
    kind: 'COMPOSER',
    featured: true,
    items: [
      {
        composer: 'Hildegarda de Bingen',
        note: 'Canto que flutua, sem compasso.',
      },
      { composer: 'Clara Schumann' },
      { composer: 'Fanny Hensel' },
      { composer: 'Cécile Chaminade' },
      { composer: 'Lili Boulanger', note: 'Viveu pouco e escreveu muito bem.' },
      { composer: 'Chiquinha Gonzaga' },
    ],
  },
  {
    title: 'Brasil de concerto',
    description:
      'Ópera, choro, modinha e orquestra: a música de concerto feita aqui.',
    kind: 'COMPOSER',
    items: [
      { composer: 'Carlos Gomes', note: 'O Guarani levou o Brasil ao Scala.' },
      { composer: 'Alberto Nepomuceno' },
      { composer: 'Chiquinha Gonzaga' },
      { composer: 'Heitor Villa-Lobos' },
      { composer: 'Francisco Mignone' },
      { composer: 'Camargo Guarnieri' },
    ],
  },
  {
    title: 'A escola russa',
    description:
      'De Glinka a Rachmaninoff, o século em que a Rússia encontrou a própria voz.',
    kind: 'COMPOSER',
    items: [
      { composer: 'Mikhail Glinka' },
      { composer: 'Modest Mussorgsky' },
      { composer: 'Nikolay Rimsky-Korsakov' },
      { composer: 'Pyotr Tchaikovsky' },
      { composer: 'Sergei Rachmaninoff' },
    ],
  },
  {
    title: 'Primeiro recital de piano',
    description:
      'Peças curtas, bonitas e possíveis para quem vai tocar em público pela primeira vez.',
    kind: 'WORK',
    featured: true,
    items: [
      { composer: 'Ludwig van Beethoven', work: 'Für Elise, WoO 59' },
      {
        composer: 'Robert Schumann',
        work: 'Kinderszenen, Op.15',
        note: 'Escolha duas ou três cenas.',
      },
      {
        composer: ' Erik Satie',
        work: '3 Gymnopédies',
        note: 'A primeira, devagar de verdade.',
      },
      { composer: 'Claude Debussy', work: "Children's Corner" },
      {
        composer: 'Frédéric Chopin',
        work: 'Preludes, Op.28',
        note: 'O nº 4 e o nº 7 são ótimos para começar.',
      },
    ],
  },
  {
    title: 'A noite no piano',
    description: 'Para tocar ou ouvir com a luz baixa.',
    kind: 'WORK',
    featured: true,
    items: [
      {
        composer: 'Frédéric Chopin',
        work: 'Nocturnes, Op.9',
        note: 'O nº 2 é o mais conhecido; o nº 1, o mais bonito.',
      },
      {
        composer: 'Claude Debussy',
        work: 'Suite bergamasque',
        note: 'Clair de lune é o terceiro movimento.',
      },
      {
        composer: 'Ludwig van Beethoven',
        work: 'Piano Sonata No.14, Op.27 No.2',
      },
      { composer: 'Gabriel Fauré', work: '3 Nocturnes, Op.33' },
    ],
  },
  {
    title: 'Barroco para violino',
    description: 'O repertório que todo violinista encontra cedo ou tarde.',
    kind: 'WORK',
    items: [
      { composer: 'Arcangelo Corelli', work: '12 Violin Sonatas, Op.5' },
      { composer: 'Antonio Vivaldi', work: 'Le quattro stagioni' },
      {
        composer: 'Johann Sebastian Bach',
        work: '6 Violin Sonatas and Partitas, BWV 1001-1006',
        note: 'A Chaconne fecha a Partita nº 2.',
      },
    ],
  },
  {
    title: 'As estações do ano',
    description:
      'Três compositores, três jeitos de pôr um ano inteiro em música.',
    kind: 'WORK',
    items: [
      { composer: 'Antonio Vivaldi', work: 'Le quattro stagioni' },
      { composer: 'Joseph Haydn', work: 'Die Jahreszeiten, Hob.XXI:3' },
      {
        composer: 'Pyotr Tchaikovsky',
        work: 'The Seasons, Op.37a',
        note: 'Um mês por peça; junho é uma barcarola.',
      },
    ],
  },
  {
    title: 'A orquestra que todo mundo já ouviu',
    description: 'Você conhece estas melodias, talvez sem saber de onde vêm.',
    kind: 'WORK',
    items: [
      {
        composer: 'Wolfgang Amadeus Mozart',
        work: 'Eine kleine Nachtmusik, K.525',
      },
      { composer: 'Ludwig van Beethoven', work: 'Symphony No.5, Op.67' },
      { composer: 'Edvard Grieg', work: 'Peer Gynt, Op.23' },
      { composer: 'Antonín Dvořák', work: 'Symphony No.9, Op.95' },
      {
        composer: 'Maurice Ravel',
        work: 'Boléro, M.81',
        note: 'O mesmo tema, cada vez com mais gente.',
      },
    ],
  },
  {
    title: 'Violão de Espanha e do Brasil',
    description:
      'Do tremolo de Tárrega às Bachianas: o violão como instrumento de concerto.',
    kind: 'WORK',
    items: [
      {
        composer: 'Francisco Tárrega',
        work: 'Recuerdos de la Alhambra',
        note: 'Estudo de tremolo antes de ser uma joia.',
      },
      { composer: 'Isaac Albéniz', work: 'Suite española No.1, Op.47' },
      {
        composer: 'Heitor Villa-Lobos',
        work: 'Bachianas brasileiras No.4, W264, 424',
      },
    ],
  },
  {
    title: 'Edições para estudar Chopin',
    description:
      'As partituras que vale abrir na estante quando a peça é de Chopin.',
    kind: 'SCORE',
    items: [
      { composer: 'Frédéric Chopin', work: 'Nocturnes, Op.9', scores: 2 },
      { composer: 'Frédéric Chopin', work: 'Preludes, Op.28', scores: 2 },
    ],
  },
  {
    title: 'Debussy na estante',
    description: 'Edições de Debussy para quem está montando o repertório.',
    kind: 'SCORE',
    items: [
      { composer: 'Claude Debussy', work: "Children's Corner", scores: 2 },
      { composer: 'Claude Debussy', work: 'Suite bergamasque', scores: 2 },
    ],
  },
];

/**
 * Seeds the team's collections (owner's choice, 11/10): an editorial
 * account, "Equipe Opus Atlas", signs a dozen public collections; four are
 * featured on the home page. Composers and works are found by exact name;
 * a missing one is logged and left out. Idempotent: a collection with the
 * same title from the team is replaced, not duplicated.
 *
 * Usage:
 *   node dist/scripts/seed-collections.js           # dry run
 *   node dist/scripts/seed-collections.js --apply   # writes
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const skipped: string[] = [];
  let written = 0;
  const logger = new Logger('SeedCollections');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const missing: string[] = [];

  const composerId = async (fullName: string) => {
    const found = await prisma.composer.findFirst({
      where: { fullName },
      orderBy: { works: { _count: 'desc' } },
      select: { id: true },
    });
    if (!found) missing.push(fullName.trim());
    return found?.id ?? null;
  };
  const workId = async (composer: string, title: string) => {
    const owner = await composerId(composer);
    if (!owner) return null;
    const works = await prisma.work.findMany({
      where: { composerId: owner, title, parentWorkId: null },
      select: { id: true, _count: { select: { cachedScores: true } } },
    });
    const best = works.sort(
      (a, b) => b._count.cachedScores - a._count.cachedScores,
    )[0];
    if (!best) missing.push(`${composer.trim()}: ${title}`);
    return best?.id ?? null;
  };

  try {
    const owner =
      (await prisma.user.findFirst({
        where: { email: TEAM.email },
        select: { id: true },
      })) ??
      (apply
        ? await prisma.user.create({
            data: { ...TEAM, emailVerified: new Date() },
            select: { id: true },
          })
        : { id: 'simulado' });

    for (const seed of SEEDS) {
      const items: { refId: string; note: string | null }[] = [];
      for (const ref of seed.items) {
        const note = ref.note ?? null;
        if (!('work' in ref)) {
          const id = await composerId(ref.composer);
          if (id && !items.some((i) => i.refId === id))
            items.push({ refId: id, note });
          continue;
        }
        const id = await workId(ref.composer, ref.work);
        if (!id) continue;
        if (!('scores' in ref)) {
          items.push({ refId: id, note });
          continue;
        }
        const scores = await prisma.workScore.findMany({
          where: { workId: id, isActive: true, type: 'SCORES' },
          orderBy: [{ groupIndex: 'asc' }, { createdAt: 'asc' }],
          select: { id: true },
          take: ref.scores,
        });
        scores.forEach((s) => items.push({ refId: s.id, note }));
      }

      logger.log(`${seed.title}: ${items.length}/${seed.items.length} itens`);
      // A smaller catalog (staging) may hold none of the works: an empty
      // collection helps no one, so it is left out, and the summary says so.
      if (!items.length) {
        skipped.push(seed.title);
        continue;
      }
      written += 1;
      if (!apply) continue;
      await prisma.collection.deleteMany({
        where: { ownerId: owner.id, title: seed.title },
      });
      await prisma.collection.create({
        data: {
          ownerId: owner.id,
          kind: seed.kind,
          title: seed.title,
          description: seed.description,
          isPublic: true,
          featuredOnHome: !!seed.featured,
          items,
        },
      });
    }

    if (apply)
      await app
        .get(AppCacheService)
        .invalidateMany([CacheNamespace.COLLECTIONS]);
    logger.log(
      `${apply ? 'Gravadas' : '[simulação] gravaria'}: ${written} coleções`,
    );
    if (skipped.length)
      logger.warn(`Sem nenhum item, ficaram de fora: ${skipped.join('; ')}`);
    if (missing.length)
      logger.warn(`Fora do banco: ${[...new Set(missing)].join('; ')}`);
  } catch (error: unknown) {
    logger.error(`Falha: ${errorMessage(error)}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    new Logger('SeedCollections').error(`Erro fatal: ${errorMessage(error)}`);
    process.exit(1);
  });
