import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { CacheNamespace } from '../../common/cache/cache-keys';
import { PrismaService } from '../../prisma/prisma.service';
import { DiscoveryResponseDto } from './dto/discovery-response.dto';
import { RecentAdditionsResponseDto } from './dto/recent-additions-response.dto';

/** Mesmo ID usado em `composers.service.ts` — identifica o papel "Compositor"
 * entre os `Role` do catálogo. Duplicado aqui (em vez de importado) para não
 * criar uma dependência cruzada entre sub-módulos por uma única constante. */
const COMPOSER_ROLE_ID = '685d591c1e3db0c5aaa893e4';

const DISCOVERIES_TTL_MS = 60 * 60 * 1000;
const RECENT_ADDITIONS_TTL_MS = 10 * 60 * 1000;

/** Compositores "óbvios" excluídos das descobertas aleatórias — a ideia da
 * seção é apresentar nomes menos conhecidos do catálogo. */
const WELL_KNOWN_COMPOSER_NAMES = [
  'Ludwig van Beethoven',
  'Wolfgang Amadeus Mozart',
  'Johann Sebastian Bach',
  'Richard Wagner',
  'Joseph Haydn',
  'Johannes Brahms',
  'Franz Schubert',
  'Peter Ilyich Tchaikovsky',
  'George Frideric Handel',
  'Igor Stravinsky',
  'Robert Schumann',
  'Felix Mendelssohn',
  'Claude Debussy',
  'Gustav Mahler',
  'Franz Liszt',
  'Maurice Ravel',
  'Antonín Dvořák',
  'Antonio Vivaldi',
  'Dmitri Shostakovich',
  'Frédéric Chopin',
];

function shuffle<T>(items: T[]): T[] {
  return [...items].sort(() => 0.5 - Math.random());
}

@Injectable()
export class DiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /** Compositores e obras menos conhecidos, sorteados a cada acesso (dentro
   * do TTL de cache). Substitui a rota legada `getRandomDiscoveries`. */
  async getDiscoveries(): Promise<DiscoveryResponseDto> {
    const cacheKey = `${CacheNamespace.DISCOVERY}:discoveries:v1`;
    const cached = await this.cacheManager.get<DiscoveryResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const composerRoleFilter = {
      OR: [
        { primaryRoleId: COMPOSER_ROLE_ID },
        { roles: { contains: COMPOSER_ROLE_ID } },
      ],
    };

    const [lesserKnownComposers, randomWorks] = await Promise.all([
      this.prisma.composer.findMany({
        where: {
          AND: [
            composerRoleFilter,
            { fullName: { notIn: WELL_KNOWN_COMPOSER_NAMES } },
          ],
        },
        select: {
          id: true,
          name: true,
          fullName: true,
          portraitUrl: true,
          epoch: { select: { name: true } },
        },
        take: 50,
      }),
      this.prisma.work.findMany({
        where: { composer: composerRoleFilter },
        select: {
          id: true,
          title: true,
          imslpPermlink: true,
          opOrCatalog: true,
          tone: true,
          composer: {
            select: { id: true, name: true, fullName: true, portraitUrl: true },
          },
          epoch: { select: { name: true } },
          instrument: { select: { name: true } },
        },
        take: 50,
      }),
    ]);

    const response: DiscoveryResponseDto = {
      composers: shuffle(lesserKnownComposers)
        .slice(0, 6)
        .map((composer) => ({
          id: composer.id,
          name: composer.name,
          fullName: composer.fullName,
          portraitUrl: composer.portraitUrl,
          epochName: composer.epoch?.name ?? 'Clássico',
        })),
      works: shuffle(randomWorks)
        .slice(0, 6)
        .map((work) => ({
          id: work.id,
          title: work.title,
          imslpPermlink: work.imslpPermlink,
          opOrCatalog: work.opOrCatalog,
          tone: work.tone,
          composer: work.composer,
          epochName: work.epoch?.name ?? 'Clássico',
          instrumentName: work.instrument?.name ?? 'Piano',
        })),
    };

    await this.cacheManager.set(cacheKey, response, DISCOVERIES_TTL_MS);
    return response;
  }

  /** Últimos compositores e obras cadastrados. Substitui a rota legada
   * `getRecentAdditions`. */
  async getRecentAdditions(): Promise<RecentAdditionsResponseDto> {
    const cacheKey = `${CacheNamespace.DISCOVERY}:recent-additions:v1`;
    const cached =
      await this.cacheManager.get<RecentAdditionsResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const [recentComposers, recentWorks] = await Promise.all([
      this.prisma.composer.findMany({
        select: {
          id: true,
          name: true,
          fullName: true,
          portraitUrl: true,
          createdAt: true,
          epochName: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 4,
      }),
      this.prisma.work.findMany({
        select: {
          id: true,
          title: true,
          mediaDuration: true,
          createdAt: true,
          composer: { select: { fullName: true } },
          instrument: { select: { name: true } },
          epoch: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 4,
      }),
    ]);

    const response: RecentAdditionsResponseDto = {
      composers: recentComposers,
      works: recentWorks.map((work) => ({
        id: work.id,
        title: work.title,
        mediaDuration: work.mediaDuration,
        createdAt: work.createdAt,
        composerFullName: work.composer?.fullName,
        instrumentName: work.instrument?.name,
        epochName: work.epoch?.name,
      })),
    };

    await this.cacheManager.set(cacheKey, response, RECENT_ADDITIONS_TTL_MS);
    return response;
  }
}
