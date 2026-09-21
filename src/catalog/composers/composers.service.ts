import { escapeRegex } from '../../common/utils/regex.util';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { CacheNamespace } from '../../common/cache/cache-keys';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ComposerCountQueryDto } from './dto/composer-count-query.dto';
import { ComposerDetailDto } from './dto/composer-detail.dto';
import { ComposerFilterOptionsResponseDto } from './dto/composer-filter-options-response.dto';
import { ComposerListItemDto } from './dto/composer-list-item.dto';
import { ComposerListQueryDto } from './dto/composer-list-query.dto';
import { ComposerWorkItemDto } from './dto/composer-work-item.dto';
import { ComposerWorksQueryDto } from './dto/composer-works-query.dto';
import { ComposerWorksResponseDto } from './dto/composer-works-response.dto';
import { ComposerWorkTypeCountsResponseDto } from './dto/composer-work-type-counts-response.dto';
import { FeaturedComposerResponseDto } from './dto/featured-composer-response.dto';
import { DifficultyLevelDto } from '../works/dto/work-filter-option-item.dto';

const COMPOSER_ROLE_ID = '685d591c1e3db0c5aaa893e4';
const COMPOSERS_LIST_TTL_MS = 5 * 60 * 1000;
const COMPOSERS_COUNT_TTL_MS = 15 * 60 * 1000;
const COMPOSERS_CURATED_TTL_MS = 6 * 60 * 60 * 1000;
const COMPOSER_DETAIL_TTL_MS = 5 * 60 * 1000;
const COMPOSER_WORKS_TTL_MS = 5 * 60 * 1000;
const COMPOSER_FILTER_OPTIONS_TTL_MS = 30 * 60 * 1000;

const FAMOUS_COMPOSER_NAMES = [
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
  'Franz Liszt ',
  'Maurice Ravel',
  'Antonín Dvořák',
  'Antonio Vivaldi',
  'Dmitri Shostakovich',
  'Steve Reich',
  'Frédéric Chopin',
];

const RECOMMENDED_COMPOSER_NAMES = [
  'Serge Prokofiev',
  'Dmitri Shostakovich',
  'Béla Bartók',
  'Hector Berlioz',
  'Anton Bruckner',
  'Giovanni Pierluigi da Palestrina',
  'Claudio Monteverdi',
  'Jean Sibelius',
  'Maurice Ravel',
  'Ralph Vaughan Williams',
  'Modest Mussorgsky',
  'Giacomo Puccini',
  'Henry Purcell',
  'Gioacchino Rossini',
  'Edward Elgar',
  'Sergei Rachmaninoff',
  'Camille Saint-Saëns',
  'Josquin Des Prez',
  'Nikolai Rimsky-Korsakov',
  'Carl Maria von Weber',
  'Jean-Philippe Rameau',
  'Jean-Baptiste Lully',
  'Gabriel Fauré',
  'Edvard Grieg',
  'Christoph Willibald Gluck',
  'Arnold Schoenberg',
  'Charles Ives',
  'Paul Hindemith',
  'Olivier Messiaen',
  'Aaron Copland',
  'Francois Couperin',
  'William Byrd',
  'Erik Satie',
  'Benjamin Britten',
  'Bedrick Smetana',
  'César Franck',
  'Alexander Nikolayevich Scriabin',
  'Georges Bizet',
  'Domenico Scarlatti',
  'Georg Philipp Telemann',
  'Anton Webern',
  'Roland de Lassus',
  'George Gershwin',
  'Gaetano Donizetti',
  'Carl Philipp Emanuel Bach',
  'Archangelo Corelli',
  'Thomas Tallis',
  'Johann Strauss II',
  'Leos Janácek',
  'Guillaume de Machaut',
  'Alban Berg',
  'Alexander Borodin',
  'Vincenzo Bellini',
  'Charles Gounod',
  'Jules Massenet',
  'Francis Poulenc',
  'Giovanni Gabrieli',
  'Pérotin',
  'Heinrich Schütz',
  'John Cage',
  'Giovanni Battista Pergolesi',
  'John Dowland',
  'Gustav Holst',
  'Dietrich Buxtehude',
  'Ottorino Respighi',
  'Guillaume Dufay',
  'Hugo Wolf',
  'Carl Nielsen',
  'William Walton',
  'Darius Milhaud',
  'Orlando Gibbons',
  'Giacomo Meyerbeer',
  'Samuel Barber',
  'Tomás Luis de Victoria',
  'Léonin',
  'Manuel de Falla',
  'Hildegard von Bingen',
  'Mikhail Glinka',
  'Alexander Glazunov',
  'Don Carlo Gesualdo',
];

/** Nomes extras que só existem na antiga lista `allFamousNames` (usada
 * exclusivamente para a rotação diária do compositor em destaque), sem
 * sobreposição com `FAMOUS_COMPOSER_NAMES`/`RECOMMENDED_COMPOSER_NAMES`. */
const EXTRA_FEATURED_COMPOSER_NAMES = [
  'Richard Strauss',
  'Philip Glass',
  'John Williams',
  'Leonard Bernstein',
  'Heitor Villa-Lobos',
  'Clara Schumann',
  'Carl Orff',
  'Max Bruch',
  'Arvo Pärt',
  'Ennio Morricone',
];

/** Pool de rotação do compositor em destaque — união das listas famosa e
 * recomendada (já existentes acima) mais alguns nomes exclusivos da lista
 * legada `allFamousNames`, evitando manter uma terceira lista quase idêntica. */
const FEATURED_COMPOSER_NAMES = Array.from(
  new Set([
    ...FAMOUS_COMPOSER_NAMES,
    ...RECOMMENDED_COMPOSER_NAMES,
    ...EXTRA_FEATURED_COMPOSER_NAMES,
  ]),
).map((name) => name.trim());

const COMPOSER_FEATURED_TTL_MS = 25 * 60 * 60 * 1000;

const FEATURED_COMPOSER_SELECT = {
  id: true,
  name: true,
  fullName: true,
  birthDate: true,
  deathDate: true,
  portraitUrl: true,
  bio: true,
  permLinkImslp: true,
  wikipediaLink: true,
  isVerified: true,
  epoch: {
    select: { name: true },
  },
  works: {
    select: { id: true, title: true, imslpPermlink: true },
    take: 3,
    orderBy: { title: 'asc' as const },
  },
} as const;

const COMPOSER_LIST_SELECT = {
  id: true,
  name: true,
  fullName: true,
  birthDate: true,
  deathDate: true,
  portraitUrl: true,
  epochId: true,
  bio: true,
  permLinkImslp: true,
  wikipediaLink: true,
  imslpId: true,
  isVerified: true,
  epoch: {
    select: {
      name: true,
    },
  },
} as const;

const COMPOSER_DETAIL_SELECT = {
  id: true,
  name: true,
  fullName: true,
  alternativeNames: true,
  videoUrl: true,
  birthDate: true,
  deathDate: true,
  portraitUrl: true,
  bio: true,
  bioEn: true,
  bioGeneratedBy: true,
  roles: true,
  permLinkImslp: true,
  wikipediaLink: true,
  epochId: true,
  primaryRoleId: true,
  createdAt: true,
  nationality: true,
  instruments: true,
  imslpCategories: true,
  isVerified: true,
  verificationStatus: true,
  verifiedBy: true,
  verifiedAt: true,
  verificationNotes: true,
  pageQuality: true,
  lastVerified: true,
  dataCompleteness: true,
  hasValidImage: true,
  epoch: {
    select: {
      name: true,
    },
  },
  primaryRole: {
    select: {
      name: true,
    },
  },
  _count: {
    select: {
      works: true,
    },
  },
} as const;

const COMPOSER_WORKS_SELECT = {
  id: true,
  title: true,
  subtitle: true,
  opOrCatalog: true,
  compositionYear: true,
  tone: true,
  mediaDuration: true,
  imslpPermlink: true,
  videoUrl: true,
  moviment: true,
  workType: true,
  workGenresArr: true,
  categoryNames: true,
  isVerified: true,
  difficultyLevel: true,
  imslpTags: true,
  instrument: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;

const DIFFICULTY_LEVELS: DifficultyLevelDto[] = [
  { value: 'BEGINNER', label: 'Iniciante' },
  { value: 'INTERMEDIATE', label: 'Intermediário' },
  { value: 'ADVANCED', label: 'Avançado' },
];

type RawComposer = Prisma.ComposerGetPayload<{
  select: typeof COMPOSER_LIST_SELECT;
}>;

type RawComposerDetail = Prisma.ComposerGetPayload<{
  select: typeof COMPOSER_DETAIL_SELECT;
}>;

type RawComposerWork = Prisma.WorkGetPayload<{
  select: typeof COMPOSER_WORKS_SELECT;
}>;

type RawFeaturedComposer = Prisma.ComposerGetPayload<{
  select: typeof FEATURED_COMPOSER_SELECT;
}>;

@Injectable()
export class ComposersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async findAll(query: ComposerListQueryDto): Promise<ComposerListItemDto[]> {
    const normalized = this.normalizeListQuery(query);
    const cacheKey = this.buildListCacheKey(normalized);
    const cached = await this.cacheManager.get<ComposerListItemDto[]>(cacheKey);

    if (cached) {
      return cached;
    }

    const skip = (normalized.page - 1) * normalized.limit;
    const composers = await this.prisma.composer.findMany({
      where: this.buildWhereClause(normalized.search, normalized.epochId),
      select: COMPOSER_LIST_SELECT,
      orderBy: {
        name: 'asc',
      },
      skip,
      take: normalized.limit,
    });

    const response = composers.map((composer) =>
      this.toComposerListItem(composer),
    );

    await this.cacheManager.set(cacheKey, response, COMPOSERS_LIST_TTL_MS);
    return response;
  }

  async count(query: ComposerCountQueryDto): Promise<number> {
    const normalized = this.normalizeCountQuery(query);
    const cacheKey = this.buildCountCacheKey(normalized);
    const cached = await this.cacheManager.get<number>(cacheKey);

    if (cached !== undefined && cached !== null) {
      return cached;
    }

    const count = await this.prisma.composer.count({
      where: this.buildWhereClause(normalized.search, normalized.epochId),
    });

    await this.cacheManager.set(cacheKey, count, COMPOSERS_COUNT_TTL_MS);
    return count;
  }

  async findFamous(): Promise<ComposerListItemDto[]> {
    return this.findCurated(
      `${CacheNamespace.COMPOSERS}:famous`,
      FAMOUS_COMPOSER_NAMES,
    );
  }

  async findRecommended(): Promise<ComposerListItemDto[]> {
    return this.findCurated(
      `${CacheNamespace.COMPOSERS}:recommended`,
      RECOMMENDED_COMPOSER_NAMES,
    );
  }

  /**
   * Compositor em destaque do dia: escolha determinística baseada no dia do
   * ano, de forma que todos os visitantes vejam o mesmo compositor durante as
   * 24h (mesmo comportamento da rota legada `featured-composer`). A chave de
   * cache já embute o dia, então o TTL de 25h é só uma rede de segurança.
   */
  async findFeatured(): Promise<FeaturedComposerResponseDto> {
    const today = new Date();
    const dayOfYear = Math.floor(
      (today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    const cacheKey = `${CacheNamespace.COMPOSERS}:featured:${today.getFullYear()}-${dayOfYear}`;

    const cached =
      await this.cacheManager.get<FeaturedComposerResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const candidates = await this.prisma.composer.findMany({
      where: { fullName: { in: FEATURED_COMPOSER_NAMES } },
      select: FEATURED_COMPOSER_SELECT,
    });
    const candidatesByName = new Map(
      candidates.map((composer) => [composer.fullName, composer]),
    );

    let picked: RawFeaturedComposer | undefined;
    for (let attempt = 0; attempt < FEATURED_COMPOSER_NAMES.length; attempt++) {
      const index = (dayOfYear + attempt) % FEATURED_COMPOSER_NAMES.length;
      picked = candidatesByName.get(FEATURED_COMPOSER_NAMES[index]);
      if (picked) {
        break;
      }
    }

    if (!picked) {
      const fallback = await this.prisma.composer.findFirst({
        where: {
          OR: [
            { primaryRoleId: COMPOSER_ROLE_ID },
            { roles: { contains: COMPOSER_ROLE_ID } },
          ],
        },
        select: FEATURED_COMPOSER_SELECT,
      });

      if (!fallback) {
        throw new NotFoundException(
          'Nenhum compositor disponível para destaque',
        );
      }
      picked = fallback;
    }

    const response = this.toFeaturedComposerDto(picked);
    await this.cacheManager.set(cacheKey, response, COMPOSER_FEATURED_TTL_MS);
    return response;
  }

  /** Contagem de obras por `workType` do compositor — usado no formulário de
   * upload para mostrar quantas obras de cada tipo já existem. */
  async getWorkTypeCounts(
    composerId: string,
  ): Promise<ComposerWorkTypeCountsResponseDto> {
    await this.assertComposerExists(composerId);

    const grouped = await this.prisma.work.groupBy({
      by: ['workType'],
      where: { composerId },
      _count: { workType: true },
    });

    const workTypeCounts: Record<string, number> = {};
    for (const item of grouped) {
      workTypeCounts[item.workType] = item._count.workType;
    }

    return { workTypeCounts, totalTypes: grouped.length };
  }

  async findOne(id: string): Promise<ComposerDetailDto> {
    const cacheKey = `${CacheNamespace.COMPOSERS}:detail:${id}`;
    const cached = await this.cacheManager.get<ComposerDetailDto>(cacheKey);

    if (cached) {
      return cached;
    }

    const composer = await this.prisma.composer.findUnique({
      where: { id },
      select: COMPOSER_DETAIL_SELECT,
    });

    if (!composer) {
      throw new NotFoundException(`Compositor com id "${id}" não encontrado`);
    }

    const response = await this.toComposerDetailDto(composer);
    await this.cacheManager.set(cacheKey, response, COMPOSER_DETAIL_TTL_MS);

    return response;
  }

  async findWorks(
    composerId: string,
    query: ComposerWorksQueryDto,
  ): Promise<ComposerWorksResponseDto> {
    await this.assertComposerExists(composerId);

    const normalized = this.normalizeWorksQuery(query);
    const cacheKey = this.buildWorksCacheKey(composerId, normalized);
    const cached =
      await this.cacheManager.get<ComposerWorksResponseDto>(cacheKey);

    if (cached) {
      return cached;
    }

    const skip = (normalized.page - 1) * normalized.limit;
    const where = this.buildComposerWorksWhere(composerId, normalized);

    const [works, totalCount] = await Promise.all([
      this.prisma.work.findMany({
        where,
        select: COMPOSER_WORKS_SELECT,
        orderBy: {
          title: 'asc',
        },
        skip,
        take: normalized.limit,
      }),
      this.prisma.work.count({ where }),
    ]);

    const response: ComposerWorksResponseDto = {
      works: works.map((work) => this.toComposerWorkItemDto(work)),
      totalCount,
      hasMore: skip + works.length < totalCount,
      currentPage: normalized.page,
    };

    await this.cacheManager.set(cacheKey, response, COMPOSER_WORKS_TTL_MS);
    return response;
  }

  async getFilterOptions(
    composerId: string,
  ): Promise<ComposerFilterOptionsResponseDto> {
    await this.assertComposerExists(composerId);

    const cacheKey = `${CacheNamespace.COMPOSERS}:${composerId}:filter-options`;
    const cached =
      await this.cacheManager.get<ComposerFilterOptionsResponseDto>(cacheKey);

    if (cached) {
      return cached;
    }

    const works = await this.prisma.work.findMany({
      where: {
        composerId,
      },
      select: {
        instrumentId: true,
        workGenresArr: true,
        categoryNames: true,
        instrument: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    const instrumentsMap = new Map<string, { id: string; name: string }>();
    const workGenresSet = new Set<string>();
    const categoriesSet = new Set<string>();

    for (const work of works) {
      if (work.instrumentId && work.instrument?.name) {
        instrumentsMap.set(work.instrumentId, {
          id: work.instrument.id,
          name: work.instrument.name,
        });
      }

      for (const genre of work.workGenresArr ?? []) {
        const normalizedGenre = genre.trim();
        if (normalizedGenre) {
          workGenresSet.add(normalizedGenre);
        }
      }

      for (const category of work.categoryNames ?? []) {
        const normalizedCategory = category.trim();
        if (normalizedCategory) {
          categoriesSet.add(normalizedCategory);
        }
      }
    }

    const response: ComposerFilterOptionsResponseDto = {
      instruments: Array.from(instrumentsMap.values()).sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
      workGenres: Array.from(workGenresSet).sort((left, right) =>
        left.localeCompare(right),
      ),
      categories: Array.from(categoriesSet).sort((left, right) =>
        left.localeCompare(right),
      ),
      difficultyLevels: DIFFICULTY_LEVELS,
    };

    await this.cacheManager.set(
      cacheKey,
      response,
      COMPOSER_FILTER_OPTIONS_TTL_MS,
    );

    return response;
  }

  private async findCurated(
    cacheKey: string,
    names: string[],
  ): Promise<ComposerListItemDto[]> {
    const cached = await this.cacheManager.get<ComposerListItemDto[]>(cacheKey);

    if (cached) {
      return cached;
    }

    const composers = await this.prisma.composer.findMany({
      where: {
        fullName: {
          in: names,
        },
      },
      select: COMPOSER_LIST_SELECT,
    });

    const order = new Map(names.map((name, index) => [name, index]));
    const response = composers
      .map((composer) => this.toComposerListItem(composer))
      .sort(
        (left, right) =>
          (order.get(left.fullName ?? '') ?? Number.MAX_SAFE_INTEGER) -
          (order.get(right.fullName ?? '') ?? Number.MAX_SAFE_INTEGER),
      );

    await this.cacheManager.set(cacheKey, response, COMPOSERS_CURATED_TTL_MS);
    return response;
  }

  private toComposerWorkItemDto(work: RawComposerWork): ComposerWorkItemDto {
    return {
      id: work.id,
      title: work.title,
      subtitle: this.normalizeOptionalString(work.subtitle),
      opOrCatalog: this.normalizeOptionalString(work.opOrCatalog),
      compositionYear: this.normalizeOptionalString(work.compositionYear),
      tone: this.normalizeOptionalString(work.tone),
      mediaDuration: this.normalizeOptionalString(work.mediaDuration),
      imslpPermlink: work.imslpPermlink,
      videoUrl: this.normalizeOptionalString(work.videoUrl),
      moviment: this.normalizeOptionalString(work.moviment),
      instrument: work.instrument
        ? {
            id: work.instrument.id,
            name: work.instrument.name,
          }
        : undefined,
      workType: work.workType,
      workGenresArr: work.workGenresArr ?? [],
      categoryNames: work.categoryNames ?? [],
      isVerified: work.isVerified,
      difficultyLevel: this.normalizeOptionalString(work.difficultyLevel),
      imslpTags: work.imslpTags ?? [],
    };
  }

  private toFeaturedComposerDto(
    composer: RawFeaturedComposer,
  ): FeaturedComposerResponseDto {
    return {
      id: composer.id,
      name: composer.name,
      fullName: composer.fullName,
      birthDate: this.normalizeOptionalString(composer.birthDate) ?? null,
      deathDate: this.normalizeOptionalString(composer.deathDate) ?? null,
      portraitUrl: this.normalizeOptionalString(composer.portraitUrl) ?? null,
      bio: this.normalizeOptionalString(composer.bio) ?? null,
      permLinkImslp:
        this.normalizeOptionalString(composer.permLinkImslp) ?? null,
      wikipediaLink:
        this.normalizeOptionalString(composer.wikipediaLink) ?? null,
      epochName: composer.epoch?.name ?? 'Clássico',
      isVerified: composer.isVerified,
      works: composer.works.map((work) => ({
        id: work.id,
        title: work.title,
        imslpPermlink: work.imslpPermlink,
      })),
    };
  }

  private toComposerListItem(composer: RawComposer): ComposerListItemDto {
    return {
      id: composer.id,
      name: composer.name,
      fullName: this.normalizeOptionalString(composer.fullName) ?? null,
      birthDate: this.normalizeOptionalString(composer.birthDate) ?? null,
      deathDate: this.normalizeOptionalString(composer.deathDate) ?? null,
      portraitUrl: this.normalizeOptionalString(composer.portraitUrl) ?? null,
      epochId: composer.epochId,
      epochName: this.normalizeOptionalString(composer.epoch?.name) ?? null,
      bio: this.normalizeOptionalString(composer.bio) ?? null,
      permLinkImslp:
        this.normalizeOptionalString(composer.permLinkImslp) ?? null,
      wikipediaLink:
        this.normalizeOptionalString(composer.wikipediaLink) ?? null,
      imslpId: this.normalizeOptionalString(composer.imslpId) ?? null,
      isVerified: composer.isVerified,
      epoch: composer.epoch?.name ? { name: composer.epoch.name } : null,
    };
  }

  private async toComposerDetailDto(
    composer: RawComposerDetail,
  ): Promise<ComposerDetailDto> {
    const roleNames = await this.resolveRoleNames(composer.roles);

    return {
      id: composer.id,
      name: composer.name,
      fullName: composer.fullName,
      videoUrl: this.normalizeOptionalString(composer.videoUrl),
      alternativeNames: this.normalizeOptionalString(composer.alternativeNames),
      birthDate: this.normalizeOptionalString(composer.birthDate),
      deathDate: this.normalizeOptionalString(composer.deathDate),
      portraitUrl: this.normalizeOptionalString(composer.portraitUrl),
      bio: this.normalizeOptionalString(composer.bio),
      bioEn: this.normalizeOptionalString(composer.bioEn),
      bioGeneratedByAi: Boolean(composer.bioGeneratedBy),
      permLinkImslp: this.normalizeOptionalString(composer.permLinkImslp),
      wikipediaLink: this.normalizeOptionalString(composer.wikipediaLink),
      epochId: composer.epochId,
      epochName: composer.epoch.name,
      primaryRoleId: this.normalizeOptionalString(composer.primaryRoleId),
      primaryRoleName: this.normalizeOptionalString(composer.primaryRole?.name),
      worksCount: composer._count.works,
      createdAt: composer.createdAt,
      roleNames,
      isVerified: composer.isVerified,
      verificationStatus: this.normalizeOptionalString(
        composer.verificationStatus,
      ),
      verifiedBy: this.normalizeOptionalString(composer.verifiedBy),
      verifiedAt: composer.verifiedAt ?? undefined,
      verificationNotes: this.normalizeOptionalString(
        composer.verificationNotes,
      ),
      nationality: this.normalizeOptionalString(composer.nationality),
      instruments: this.normalizeOptionalString(composer.instruments),
      imslpCategories: this.normalizeOptionalString(composer.imslpCategories),
      pageQuality: this.normalizeOptionalString(composer.pageQuality),
      lastVerified: composer.lastVerified ?? undefined,
      dataCompleteness: composer.dataCompleteness ?? undefined,
      hasValidImage: composer.hasValidImage,
      epoch: composer.epoch?.name ? { name: composer.epoch.name } : null,
    };
  }

  private async resolveRoleNames(
    roles: string | null | undefined,
  ): Promise<string[]> {
    if (!roles) {
      return [];
    }

    const roleIds = roles
      .split(',')
      .map((roleId) => roleId.trim())
      .filter(Boolean);

    if (roleIds.length === 0) {
      return [];
    }

    const resolvedRoles = await this.prisma.role.findMany({
      where: {
        id: {
          in: roleIds,
        },
      },
      select: {
        name: true,
      },
    });

    return resolvedRoles.map((role) => role.name);
  }

  private async assertComposerExists(id: string): Promise<void> {
    const composer = await this.prisma.composer.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!composer) {
      throw new NotFoundException(`Compositor com id "${id}" não encontrado`);
    }
  }

  private buildComposerWorksWhere(
    composerId: string,
    query: Required<ComposerWorksQueryDto>,
  ): Prisma.WorkWhereInput {
    const where: Prisma.WorkWhereInput = {
      composerId,
    };

    if (query.instrumentId) {
      where.instrumentId = query.instrumentId;
    }

    if (query.workGenresArr) {
      where.workGenresArr = {
        has: query.workGenresArr,
      };
    }

    if (query.categoryNames) {
      where.categoryNames = {
        has: query.categoryNames,
      };
    }

    if (query.workType) {
      where.workType = query.workType as Prisma.EnumWorkTypeFilter;
    }

    if (query.difficultyLevel) {
      where.difficultyLevel = query.difficultyLevel;
    }

    if (query.search) {
      where.OR = [
        {
          title: {
            contains: escapeRegex(query.search),
            mode: 'insensitive',
          },
        },
        {
          subtitle: {
            contains: escapeRegex(query.search),
            mode: 'insensitive',
          },
        },
        {
          opOrCatalog: {
            contains: escapeRegex(query.search),
            mode: 'insensitive',
          },
        },
        {
          tone: {
            contains: escapeRegex(query.search),
            mode: 'insensitive',
          },
        },
        {
          moviment: {
            contains: escapeRegex(query.search),
            mode: 'insensitive',
          },
        },
      ];
    }

    return where;
  }

  private buildWhereClause(
    search?: string,
    epochId?: string,
  ): Prisma.ComposerWhereInput {
    const roleFilter: Prisma.ComposerWhereInput[] = [
      {
        primaryRoleId: COMPOSER_ROLE_ID,
      },
      {
        roles: {
          contains: COMPOSER_ROLE_ID,
        },
      },
    ];

    const hasSearch = Boolean(search?.trim());
    const hasEpochId = Boolean(epochId?.trim());

    if (!hasSearch && !hasEpochId) {
      return { OR: roleFilter };
    }

    const andConditions: Prisma.ComposerWhereInput[] = [{ OR: roleFilter }];

    if (hasSearch) {
      const terms = search!.trim().split(/\s+/);
      andConditions.push({
        OR: [
          {
            AND: terms.map((term) => ({
              name: {
                contains: escapeRegex(term),
                mode: 'insensitive',
              },
            })),
          },
          {
            AND: terms.map((term) => ({
              fullName: {
                contains: escapeRegex(term),
                mode: 'insensitive',
              },
            })),
          },
        ],
      });
    }

    if (hasEpochId) {
      andConditions.push({
        epochId: epochId!.trim(),
      });
    }

    return { AND: andConditions };
  }

  private normalizeListQuery(
    query: ComposerListQueryDto,
  ): Required<ComposerListQueryDto> {
    return {
      page: Math.max(query.page ?? 1, 1),
      limit: Math.min(Math.max(query.limit ?? 30, 1), 100),
      search: query.search?.trim() ?? '',
      epochId: query.epochId?.trim() ?? '',
    };
  }

  private normalizeCountQuery(
    query: ComposerCountQueryDto,
  ): Required<ComposerCountQueryDto> {
    return {
      search: query.search?.trim() ?? '',
      epochId: query.epochId?.trim() ?? '',
    };
  }

  private normalizeWorksQuery(
    query: ComposerWorksQueryDto,
  ): Required<ComposerWorksQueryDto> {
    return {
      page: Math.max(query.page ?? 1, 1),
      limit: Math.min(Math.max(query.limit ?? 50, 1), 100),
      instrumentId: query.instrumentId?.trim() ?? '',
      workGenresArr: query.workGenresArr?.trim() ?? '',
      categoryNames: query.categoryNames?.trim() ?? '',
      search: query.search?.trim() ?? '',
      workType: query.workType?.trim() ?? '',
      difficultyLevel: query.difficultyLevel?.trim() ?? '',
    };
  }

  private buildListCacheKey(query: Required<ComposerListQueryDto>): string {
    return [
      `${CacheNamespace.COMPOSERS}:list`,
      query.page,
      query.limit,
      query.search || 'all',
      query.epochId || 'all',
    ].join(':');
  }

  private buildCountCacheKey(query: Required<ComposerCountQueryDto>): string {
    return [
      `${CacheNamespace.COMPOSERS}:count`,
      query.search || 'all',
      query.epochId || 'all',
    ].join(':');
  }

  private buildWorksCacheKey(
    composerId: string,
    query: Required<ComposerWorksQueryDto>,
  ): string {
    return [
      `${CacheNamespace.COMPOSERS}:works`,
      composerId,
      query.page,
      query.limit,
      query.instrumentId || 'all',
      query.workGenresArr || 'all',
      query.categoryNames || 'all',
      query.search || 'all',
      query.workType || 'all',
      query.difficultyLevel || 'all',
    ].join(':');
  }

  private normalizeOptionalString(
    value: string | null | undefined,
  ): string | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }
}
