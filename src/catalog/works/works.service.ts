import { escapeRegex } from '../../common/utils/regex.util';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StorageAssetKind, StorageAssetStatus } from '@prisma/client';
import { StorageService } from '../../common/storage/storage.service';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace } from '../../common/cache/cache-keys';
import { ImslpScoresService } from './imslp-scores.service';
import { workDetailCacheKey } from './work-cache-keys';
import { PrismaService } from '../../prisma/prisma.service';
import { GetWorksCatalogQueryDto } from './dto/get-works-catalog-query.dto';
import {
  DifficultyLevelDto,
  PopularComposerFilterDto,
  WorkFilterOptionItemDto,
} from './dto/work-filter-option-item.dto';
import { WorkFilterOptionsResponseDto } from './dto/work-filter-options-response.dto';
import { WorkDetailDto } from './dto/work-detail.dto';
import { SearchWorksQueryDto } from './dto/search-works-query.dto';
import { SearchWorkGenresQueryDto } from './dto/search-work-genres-query.dto';
import { WorkCatalogItemDto } from './dto/work-catalog-item.dto';
import { WorksCatalogResponseDto } from './dto/works-catalog-response.dto';
import { WorkSummaryDto } from './dto/work-summary.dto';
import { WorkGenreItemDto } from './dto/work-genre-item.dto';
import { RelatedWorkItemDto } from './dto/related-work-item.dto';
import { UpdateWorkMediaDto } from './dto/update-work-media.dto';
import { WorkMediaResponseDto } from './dto/work-media-response.dto';
import { GetWorkScoresQueryDto } from './dto/get-work-scores-query.dto';
import {
  WorkScoreItemDto,
  WorkScoresResponseDto,
} from './dto/work-score-item.dto';
import { errorMessage } from '../../common/utils/error.util';
import { TextIndexService } from '../../common/search/text-index.service';

/** Select Prisma reaproveitado em toda query de listagem/detalhe de obra —
 * mantém o payload BSON enxuto (seção 3.7 e 10.4 do SPEC.md: nunca buscar
 * documento completo quando só alguns campos são usados). */
const WORK_SUMMARY_SELECT = {
  id: true,
  title: true,
  opOrCatalog: true,
  composer: {
    select: {
      name: true,
      fullName: true,
    },
  },
  instrument: {
    select: {
      name: true,
    },
  },
  // Contador denormalizado, mantido por `AnnotationsService` a cada anotação
  // criada ou apagada. Pedir `_count: { workAnnotations: true }` no lugar dele
  // faz o Prisma emitir um `$lookup` por obra retornada — e, quando a
  // ordenação também dependia da contagem, por obra da coleção inteira.
  annotationsCount: true,
} as const;

/**
 * Ordenação padrão: obras com mais anotações primeiro, depois alfabético — a
 * mesma regra de negócio de sempre, por outro caminho.
 *
 * **O que mudou e por quê.** Ordenar por `workAnnotations: { _count: 'desc' }`
 * obriga o Prisma a contar as anotações de **cada uma das 207 mil obras** antes
 * de escolher as dez primeiras: um `$lookup` na coleção inteira, medido em
 * 3,7 s com a coleção de anotações vazia e em 15,4 s com dado real. Como não há
 * teto de tempo no banco, sob carga essas consultas ocupavam o pool do Prisma e
 * as rápidas morriam na fila — foi assim que o processo parou de responder no
 * teste de carga.
 *
 * `annotationsCount` é o mesmo número, já gravado na obra e mantido a cada
 * anotação criada ou apagada, e é coberto pelo índice
 * `[annotationsCount(sort: Desc), title]`: 10 documentos examinados no lugar de
 * 207.892, 1 ms no lugar de 3,7 s.
 *
 * **Sem desempate por `id`, de propósito.** Acrescentar um terceiro critério
 * que o índice não cobre faz o MongoDB descartar o índice e ordenar a coleção
 * inteira em memória — medido aqui: 344 ms com o desempate, 30 ms sem ele. Esta
 * ordenação só alimenta listas com teto (as N mais anotadas), nunca uma
 * paginação, então a instabilidade entre empates não tem onde aparecer.
 */
const WORK_DEFAULT_ORDER_BY = [
  { annotationsCount: 'desc' as const },
  { title: 'asc' as const },
];

type RawWork = {
  id: string;
  title: string;
  opOrCatalog: string | null;
  composer: { name: string; fullName: string | null };
  instrument: { name: string };
  annotationsCount: number;
};

type CatalogFilterType = 'NONE' | 'SIMPLE' | 'SEARCH' | 'COMPLEX';

const WORK_CATALOG_CACHE_TTL_MS: Record<CatalogFilterType, number> = {
  NONE: 60 * 60 * 1000,
  SIMPLE: 30 * 60 * 1000,
  SEARCH: 15 * 60 * 1000,
  COMPLEX: 30 * 60 * 1000,
};

const WORK_FILTER_OPTIONS_CACHE_TTL_MS = 30 * 60 * 1000;
const WORK_DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;
const WORK_SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * TTL da camada em memória do processo (ver `HotCache`).
 *
 * Só vale para leitura pública de catálogo, que é idêntica para todo visitante.
 * Dez segundos é o teto de divergência entre réplicas: a invalidação limpa o
 * Redis e o L1 de quem a executou, e as demais réplicas servem o valor anterior
 * até aqui. Em troca, a resposta quente não sai do processo.
 */
const WORK_HOT_CACHE_TTL_MS = 10 * 1000;

/**
 * Teto de tempo **no banco** para as agregações da busca.
 *
 * Diferente do `TimeoutInterceptor`, que corta a resposta HTTP mas deixa a
 * consulta correndo e segurando a conexão do pool. `maxTimeMS` manda o próprio
 * MongoDB desistir — é o que impede uma busca patológica de derrubar a réplica.
 */
const SEARCH_MAX_TIME_MS = 8_000;

/**
 * Teto de compositores considerados por um termo de busca. Um termo que casa
 * com mais compositores que isto não é uma busca por compositor — é um termo
 * genérico, e o casamento por título já cobre o resultado.
 */
const SEARCH_COMPOSER_CAP = 200;

const WORK_CATALOG_BASE_SELECT = {
  id: true,
  title: true,
  subtitle: true,
  opOrCatalog: true,
  compositionYear: true,
  tone: true,
  mediaDuration: true,
  workType: true,
  isVerified: true,
  composerId: true,
  instrumentId: true,
  epochId: true,
} as const;

const WORK_CATALOG_FALLBACK_SELECT = {
  id: true,
  title: true,
  subtitle: true,
  opOrCatalog: true,
  compositionYear: true,
  tone: true,
  mediaDuration: true,
  workType: true,
  isVerified: true,
  composer: {
    select: {
      id: true,
      name: true,
      fullName: true,
      epochName: true,
    },
  },
  instrument: {
    select: {
      name: true,
    },
  },
  epoch: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;

const WORK_DETAIL_SELECT = {
  id: true,
  title: true,
  opOrCatalog: true,
  subtitle: true,
  compositionYear: true,
  firstPublishDate: true,
  tone: true,
  mediaDuration: true,
  imslpPermlink: true,
  imslpId: true,
  videoUrl: true,
  workStyle: true,
  moviment: true,
  dedicateTo: true,
  instrumentation: true,
  workType: true,
  movementNumber: true,
  createdAt: true,
  instrumentId: true,
  epochId: true,
  categoryNames: true,
  workGenresArr: true,
  isVerified: true,
  createdBy: true,
  parentWorkId: true,
  spotifyTrackId: true,
  spotifyTrackUrl: true,
  spotifyDisplayTitle: true,
  spotifyDuration: true,
  spotifyArtists: true,
  spotifyThumbnail: true,
  youtubeVideoId: true,
  youtubeVideoUrl: true,
  youtubeTitle: true,
  videoAulaUrl: true,
  videoAulaFile: true,
  videoAulaMetadata: true,
  videoAulaSource: true,
  videoAulaTitle: true,
  videoAulaType: true,
  videoAulaAddedAt: true,
  videoAulaAddedBy: true,
  customAudioUrl: true,
  customAudioFile: true,
  customAudioMetadata: true,
  customAudioSource: true,
  mediaSource: true,
  lastMediaSearch: true,
  mediaSearchError: true,
  difficultyLevel: true,
  composer: {
    select: {
      id: true,
      name: true,
      fullName: true,
      epochName: true,
      portraitUrl: true,
    },
  },
} as const;

type RawWorkDetail = Prisma.WorkGetPayload<{
  select: typeof WORK_DETAIL_SELECT;
}>;

const DIFFICULTY_LEVELS: DifficultyLevelDto[] = [
  { value: 'BEGINNER', label: 'Iniciante' },
  { value: 'INTERMEDIATE', label: 'Intermediário' },
  { value: 'ADVANCED', label: 'Avançado' },
];

const FAMOUS_COMPOSERS = [
  'Ludwig van Beethoven',
  'Wolfgang Amadeus Mozart',
  'Johann Sebastian Bach',
  'Frédéric Chopin',
  'Franz Liszt',
  'Pyotr Ilyich Tchaikovsky',
  'Claude Debussy',
  'Johannes Brahms',
  'Antonio Vivaldi',
  'Franz Schubert',
];

const WORK_RELATED_TTL_MS = 15 * 60 * 1000;
const WORK_GENRES_TTL_MS = 30 * 60 * 1000;

/** Classifica um `WorkScore` num dos 6 "baldes" usados pela UI de partituras —
 * mesmas categorias da rota legada `work-scores`. Fontes `CUSTOM`/`UPLOAD` vão
 * sempre para "uploads", independente do `type`. */
function classifyScoreBucket(score: { source: string; type: string }): string {
  if (score.source === 'UPLOAD' || score.source === 'CUSTOM') {
    return 'uploads';
  }

  const type = score.type.toLowerCase();
  if (type.includes('score')) return 'scores';
  if (type.includes('part')) return 'parts';
  if (type.includes('arrangement')) return 'arrangements';
  if (type.includes('libretto')) return 'librettos';
  return 'others';
}

@Injectable()
export class WorksService {
  private readonly logger = new Logger(WorksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appCache: AppCacheService,
    private readonly imslpScores: ImslpScoresService,
    private readonly textIndex: TextIndexService,
    private readonly storage: StorageService,
  ) {}

  private toSummaryDto(work: RawWork): WorkSummaryDto {
    return {
      id: work.id,
      title: work.title,
      opOrCatalog: this.normalizeOptionalString(work.opOrCatalog) ?? null,
      composer: work.composer,
      instrumentName: work.instrument.name,
      annotationsCount: work.annotationsCount,
    };
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

  /**
   * Busca obras por termo textual, ID direto, ou retorna as mais populares
   * quando nenhum filtro é informado. Regra de negócio idêntica à rota
   * legada `GET /api/works` do Next.js (ver seção 4.7.4 do SPEC.md).
   */
  async search(query: SearchWorksQueryDto): Promise<WorkSummaryDto[]> {
    const limit = Math.min(query.limit ?? 10, 50);
    const term = query.q?.trim() ?? '';
    const cacheKey = `${CacheNamespace.WORKS}:search:v2:${JSON.stringify({
      id: query.id ?? null,
      q: term.length >= 2 ? term.toLowerCase() : null,
      limit,
    })}`;

    // Resposta pública e igual para todo mundo: cabe no L1 e vale o
    // single-flight — quem chega junto espera o mesmo cálculo em vez de
    // disparar o seu.
    return this.appCache.remember(
      cacheKey,
      {
        ttlMs: WORK_SEARCH_CACHE_TTL_MS,
        hotTtlMs: WORK_HOT_CACHE_TTL_MS,
        metricRoute: 'works/search',
      },
      () => this.runSearch(query.id, term, limit),
    );
  }

  private async runSearch(
    id: string | undefined,
    term: string,
    limit: number,
  ): Promise<WorkSummaryDto[]> {
    if (id) {
      const work = await this.findById(id);
      return work ? [work] : [];
    }

    if (term.length < 2) {
      return this.findPopular(limit);
    }

    const ids = await this.searchWorkIds(term, limit);

    if (ids.length === 0) {
      return [];
    }

    const works = await this.prisma.work.findMany({
      where: { id: { in: ids } },
      select: WORK_SUMMARY_SELECT,
    });

    // `findMany` com `in` não preserva a ordem dos ids; reordena pela
    // relevância devolvida pela busca.
    const byId = new Map(works.map((work) => [work.id, work]));
    const ordered = ids
      .map((id) => byId.get(id))
      .filter((work): work is (typeof works)[number] => work !== undefined);

    this.logger.debug(`Busca por "${term}" retornou ${ordered.length} obra(s)`);

    return ordered.map((work) => this.toSummaryDto(work));
  }

  /**
   * Resolve os ids das obras que casam com o termo.
   *
   * Usa o índice de texto do MongoDB (`$text`) quando ele existe, o que troca
   * uma varredura de 200 mil documentos por uma busca indexada e ainda ordena
   * por relevância (`textScore`). Sem o índice — instância nova, ou criação que
   * falhou no boot — cai no regex antigo, que continua correto, só mais lento.
   *
   * Ver seção 10.3 da SPEC e `TextIndexService`.
   */
  private async searchWorkIds(term: string, limit: number): Promise<string[]> {
    if (this.textIndex.hasTextIndex('Work')) {
      try {
        const result = await this.prisma.work.aggregateRaw({
          pipeline: [
            { $match: { $text: { $search: term } } },
            { $addFields: { _score: { $meta: 'textScore' } } },
            { $sort: { _score: -1 } },
            { $limit: limit },
            { $project: { _id: 1 } },
          ],
          // Teto no banco, não só na resposta: sem ele uma busca patológica
          // segura a conexão do pool depois de o cliente já ter desistido.
          options: { maxTimeMS: SEARCH_MAX_TIME_MS },
        });

        const rows = result as unknown as Array<{
          _id: { $oid?: string } | string;
        }>;

        return rows
          .map((row) =>
            typeof row._id === 'string' ? row._id : (row._id.$oid ?? ''),
          )
          .filter(Boolean);
      } catch (error: unknown) {
        this.logger.warn(
          `Busca por índice de texto falhou, usando regex: ${errorMessage(error)}`,
        );
      }
    }

    const works = await this.prisma.work.findMany({
      where: {
        OR: [
          { title: { contains: escapeRegex(term), mode: 'insensitive' } },
          {
            composer: {
              OR: [
                { name: { contains: escapeRegex(term), mode: 'insensitive' } },
                {
                  fullName: {
                    contains: escapeRegex(term),
                    mode: 'insensitive',
                  },
                },
              ],
            },
          },
          { opOrCatalog: { contains: escapeRegex(term), mode: 'insensitive' } },
        ],
      },
      select: { id: true },
      orderBy: WORK_DEFAULT_ORDER_BY,
      take: limit,
    });

    return works.map((work) => work.id);
  }

  private async findById(id: string): Promise<WorkSummaryDto | null> {
    const work = await this.prisma.work.findUnique({
      where: { id },
      select: WORK_SUMMARY_SELECT,
    });

    return work ? this.toSummaryDto(work) : null;
  }

  /**
   * As obras mais anotadas — o que `GET /works` devolve sem termo de busca.
   *
   * É uma consulta indexada de ponta a ponta (ver `WORK_DEFAULT_ORDER_BY`): o
   * Mongo lê `limit` chaves do índice e busca `limit` documentos, sem tocar no
   * resto da coleção.
   */
  private async findPopular(limit: number): Promise<WorkSummaryDto[]> {
    const works = await this.prisma.work.findMany({
      select: WORK_SUMMARY_SELECT,
      orderBy: WORK_DEFAULT_ORDER_BY,
      take: limit,
    });

    return works.map((work) => this.toSummaryDto(work));
  }

  /**
   * Busca uma obra por ID, lançando 404 semântico se não existir.
   * Usado por endpoints que exigem a obra (ex.: upload de mídia, verificação).
   */
  async getByIdOrThrow(id: string): Promise<WorkSummaryDto> {
    const work = await this.findById(id);
    if (!work) {
      throw new NotFoundException(`Obra com id "${id}" não encontrada`);
    }
    return work;
  }

  async findOne(id: string): Promise<WorkDetailDto> {
    return this.appCache.remember(
      workDetailCacheKey(id),
      {
        ttlMs: WORK_DETAIL_CACHE_TTL_MS,
        hotTtlMs: WORK_HOT_CACHE_TTL_MS,
        metricRoute: 'works/detail',
      },
      () => this.loadDetail(id),
    );
  }

  private async loadDetail(id: string): Promise<WorkDetailDto> {
    const work = await this.prisma.work.findUnique({
      where: { id },
      select: WORK_DETAIL_SELECT,
    });

    if (!work) {
      throw new NotFoundException(`Obra com id "${id}" não encontrada`);
    }

    const [parentWork, childWorks, instrument, epoch] = await Promise.all([
      work.parentWorkId
        ? this.prisma.work.findUnique({
            where: { id: work.parentWorkId },
            select: {
              id: true,
              title: true,
              composer: {
                select: {
                  id: true,
                  name: true,
                  fullName: true,
                },
              },
            },
          })
        : null,
      this.prisma.work.findMany({
        where: {
          parentWorkId: id,
        },
        select: {
          id: true,
          title: true,
          subtitle: true,
        },
        orderBy: {
          title: 'asc',
        },
      }),
      work.instrumentId
        ? this.prisma.instrument.findUnique({
            where: { id: work.instrumentId },
            select: { id: true, name: true },
          })
        : null,
      work.epochId
        ? this.prisma.epoch.findUnique({
            where: { id: work.epochId },
            select: { id: true, name: true },
          })
        : null,
    ]);

    return this.toWorkDetailDto(
      work,
      parentWork,
      childWorks,
      instrument,
      epoch,
    );
  }

  async getCatalog(
    query: GetWorksCatalogQueryDto,
  ): Promise<WorksCatalogResponseDto> {
    const normalizedQuery = await this.normalizeCatalogQuery(query);
    const filterType = this.determineCatalogFilterType(normalizedQuery);
    const cacheKey = this.buildCatalogCacheKey(normalizedQuery);

    return this.appCache.remember(
      cacheKey,
      {
        ttlMs: WORK_CATALOG_CACHE_TTL_MS[filterType],
        hotTtlMs: WORK_HOT_CACHE_TTL_MS,
        metricRoute: 'works/catalog',
      },
      () =>
        filterType === 'NONE'
          ? this.getCatalogWithoutFilters(
              normalizedQuery.page!,
              normalizedQuery.limit!,
            )
          : this.getCatalogWithFilters(
              normalizedQuery.page!,
              normalizedQuery.limit!,
              normalizedQuery,
            ),
    );
  }

  private toWorkDetailDto(
    work: RawWorkDetail,
    parentWork: {
      id: string;
      title: string;
      // `Composer.fullName` é obrigatório no schema — a anotação anterior
      // (`string | null`) era mais larga que o dado real e que o DTO de saída.
      composer: { id: string; name: string; fullName: string };
    } | null,
    childWorks: Array<{ id: string; title: string; subtitle: string | null }>,
    instrument: { id: string; name: string } | null,
    epoch: { id: string; name: string } | null,
  ): WorkDetailDto {
    return {
      id: work.id,
      title: work.title,
      opOrCatalog: this.normalizeOptionalString(work.opOrCatalog),
      subtitle: this.normalizeOptionalString(work.subtitle) ?? null,
      compositionYear: this.normalizeOptionalString(work.compositionYear),
      firstPublishDate: this.normalizeOptionalString(work.firstPublishDate),
      tone: this.normalizeOptionalString(work.tone),
      mediaDuration: this.normalizeOptionalString(work.mediaDuration),
      imslpPermlink: work.imslpPermlink,
      imslpId: work.imslpId,
      videoUrl: this.normalizeOptionalString(work.videoUrl),
      workStyle: this.normalizeOptionalString(work.workStyle),
      moviment: this.normalizeOptionalString(work.moviment),
      dedicateTo: this.normalizeOptionalString(work.dedicateTo),
      instrumentation: this.normalizeOptionalString(work.instrumentation),
      workType: work.workType,
      movementNumber: work.movementNumber ?? undefined,
      createdAt: work.createdAt,
      isVerified: work.isVerified,
      createdBy: this.normalizeOptionalString(work.createdBy) ?? null,
      parentWorkId: this.normalizeOptionalString(work.parentWorkId) ?? null,
      parentWork: parentWork
        ? {
            id: parentWork.id,
            title: parentWork.title,
            composer: {
              id: parentWork.composer.id,
              name: parentWork.composer.name,
              fullName: parentWork.composer.fullName,
            },
          }
        : null,
      childWorks: childWorks.map((childWork) => ({
        id: childWork.id,
        title: childWork.title,
        subtitle: this.normalizeOptionalString(childWork.subtitle) ?? null,
      })),
      spotifyTrackId: this.normalizeOptionalString(work.spotifyTrackId) ?? null,
      spotifyTrackUrl:
        this.normalizeOptionalString(work.spotifyTrackUrl) ?? null,
      spotifyDisplayTitle:
        this.normalizeOptionalString(work.spotifyDisplayTitle) ?? null,
      spotifyDuration: work.spotifyDuration ?? null,
      spotifyArtists: work.spotifyArtists ?? null,
      spotifyThumbnail:
        this.normalizeOptionalString(work.spotifyThumbnail) ?? null,
      youtubeVideoId: this.normalizeOptionalString(work.youtubeVideoId) ?? null,
      youtubeVideoUrl:
        this.normalizeOptionalString(work.youtubeVideoUrl) ?? null,
      youtubeTitle: this.normalizeOptionalString(work.youtubeTitle) ?? null,
      videoAulaUrl: this.normalizeOptionalString(work.videoAulaUrl) ?? null,
      videoAulaFile: this.normalizeOptionalString(work.videoAulaFile) ?? null,
      videoAulaMetadata: work.videoAulaMetadata ?? null,
      videoAulaSource:
        this.normalizeOptionalString(work.videoAulaSource) ?? null,
      videoAulaTitle: this.normalizeOptionalString(work.videoAulaTitle) ?? null,
      videoAulaType: this.normalizeOptionalString(work.videoAulaType) ?? null,
      videoAulaAddedAt: work.videoAulaAddedAt ?? null,
      videoAulaAddedBy:
        this.normalizeOptionalString(work.videoAulaAddedBy) ?? null,
      customAudioUrl: this.normalizeOptionalString(work.customAudioUrl) ?? null,
      customAudioFile:
        this.normalizeOptionalString(work.customAudioFile) ?? null,
      customAudioMetadata: work.customAudioMetadata ?? null,
      customAudioSource:
        this.normalizeOptionalString(work.customAudioSource) ?? null,
      mediaSource: this.normalizeOptionalString(work.mediaSource) ?? null,
      lastMediaSearch: work.lastMediaSearch ?? null,
      mediaSearchError:
        this.normalizeOptionalString(work.mediaSearchError) ?? null,
      difficultyLevel:
        this.normalizeOptionalString(work.difficultyLevel) ?? null,
      composer: {
        id: work.composer.id,
        name: work.composer.name,
        fullName: work.composer.fullName,
        epochName:
          this.normalizeOptionalString(work.composer.epochName) ?? null,
        portraitUrl:
          this.normalizeOptionalString(work.composer.portraitUrl) ?? null,
      },
      instrument,
      epoch,
      categoryNames: work.categoryNames,
      workGenresArr: work.workGenresArr,
    };
  }

  async getFilterOptions(): Promise<WorkFilterOptionsResponseDto> {
    return this.appCache.remember(
      `${CacheNamespace.WORKS}:filter-options:v1`,
      {
        ttlMs: WORK_FILTER_OPTIONS_CACHE_TTL_MS,
        hotTtlMs: WORK_HOT_CACHE_TTL_MS,
        metricRoute: 'works/filter-options',
      },
      () => this.loadFilterOptions(),
    );
  }

  private async loadFilterOptions(): Promise<WorkFilterOptionsResponseDto> {
    const [instruments, epochs, workGenres, popularComposers] =
      await Promise.all([
        this.prisma.instrument.findMany({
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
          take: 50,
        }),
        this.prisma.epoch.findMany({
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.workGenre.findMany({
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
          take: 30,
        }),
        // Nome exato, não `contains`: a lista é fixa e conhecida, e vinte
        // regex insensíveis a maiúsculas varriam os 19 mil compositores a cada
        // carga dos filtros — 197 ms, contra 29 ms pelos índices de `name` e
        // `fullName`, com o mesmo resultado (medido em 20/09).
        this.prisma.composer.findMany({
          where: {
            OR: [
              { fullName: { in: FAMOUS_COMPOSERS } },
              { name: { in: FAMOUS_COMPOSERS } },
            ],
          },
          select: {
            id: true,
            name: true,
            fullName: true,
            _count: { select: { works: true } },
          },
          orderBy: { works: { _count: 'desc' } },
          take: 25,
        }),
      ]);

    return {
      instruments: instruments.map((item) => this.toFilterOptionItem(item)),
      epochs: epochs.map((item) => this.toFilterOptionItem(item)),
      workGenres: workGenres.map((item) => this.toFilterOptionItem(item)),
      popularComposers: popularComposers.map((composer) =>
        this.toPopularComposerFilter(composer),
      ),
      difficultyLevels: DIFFICULTY_LEVELS,
    };
  }

  private async normalizeCatalogQuery(
    query: GetWorksCatalogQueryDto,
  ): Promise<GetWorksCatalogQueryDto> {
    const normalized: GetWorksCatalogQueryDto = {
      ...query,
      page: Math.max(1, query.page ?? 1),
      limit: Math.min(100, Math.max(1, query.limit ?? 32)),
      search: query.search?.trim() || undefined,
      categoryNames: query.categoryNames?.trim() || undefined,
      workGenresArr: query.workGenresArr?.trim() || undefined,
    };

    if (normalized.workGenreId && !normalized.workGenresArr) {
      const workGenre = await this.prisma.workGenre.findUnique({
        where: { id: normalized.workGenreId },
        select: { name: true },
      });
      normalized.workGenresArr = workGenre?.name;
    }

    return normalized;
  }

  private determineCatalogFilterType(
    query: GetWorksCatalogQueryDto,
  ): CatalogFilterType {
    const activeFilters = [
      query.composerId,
      query.instrumentId,
      query.epochId,
      query.difficultyLevel,
      query.categoryNames,
      query.workGenresArr,
      query.workGenreId,
    ].filter(Boolean);

    if (!query.search && activeFilters.length === 0) {
      return 'NONE';
    }

    if (query.search) {
      return 'SEARCH';
    }

    return activeFilters.length <= 1 ? 'SIMPLE' : 'COMPLEX';
  }

  private buildCatalogCacheKey(query: GetWorksCatalogQueryDto): string {
    return `${CacheNamespace.WORKS}:catalog:v1:${JSON.stringify({
      page: query.page,
      limit: query.limit,
      composerId: query.composerId ?? null,
      instrumentId: query.instrumentId ?? null,
      epochId: query.epochId ?? null,
      workGenreId: query.workGenreId ?? null,
      workGenresArr: query.workGenresArr ?? null,
      categoryNames: query.categoryNames ?? null,
      difficultyLevel: query.difficultyLevel ?? null,
      search: query.search ?? null,
    })}`;
  }

  private async getCatalogWithoutFilters(
    page: number,
    limit: number,
  ): Promise<WorksCatalogResponseDto> {
    const skip = (page - 1) * limit;

    const [works, totalCount] = await Promise.all([
      this.prisma.work.findMany({
        select: WORK_CATALOG_BASE_SELECT,
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.getCachedTotalWorkCount(),
    ]);

    const [composers, instruments, epochs] = await Promise.all([
      this.prisma.composer.findMany({
        where: {
          id: { in: [...new Set(works.map((work) => work.composerId))] },
        },
        select: { id: true, name: true, fullName: true, epochName: true },
      }),
      this.prisma.instrument.findMany({
        where: {
          id: {
            in: [
              ...new Set(
                works.map((work) => work.instrumentId).filter(Boolean),
              ),
            ],
          },
        },
        select: { id: true, name: true },
      }),
      this.prisma.epoch.findMany({
        where: { id: { in: [...new Set(works.map((work) => work.epochId))] } },
        select: { id: true, name: true },
      }),
    ]);

    const composerMap = new Map(
      composers.map((composer) => [composer.id, composer]),
    );
    const instrumentMap = new Map(
      instruments.map((instrument) => [instrument.id, instrument]),
    );
    const epochMap = new Map(epochs.map((epoch) => [epoch.id, epoch]));

    return {
      works: works.map((work) => ({
        id: work.id,
        title: work.title,
        subtitle: this.normalizeOptionalString(work.subtitle),
        opOrCatalog: this.normalizeOptionalString(work.opOrCatalog),
        compositionYear: this.normalizeOptionalString(work.compositionYear),
        tone: this.normalizeOptionalString(work.tone),
        mediaDuration: this.normalizeOptionalString(work.mediaDuration),
        workType: work.workType,
        isVerified: work.isVerified,
        composer: composerMap.get(work.composerId) ?? {
          id: '',
          name: 'Desconhecido',
          fullName: null,
          epochName: null,
        },
        instrument: work.instrumentId
          ? {
              name:
                instrumentMap.get(work.instrumentId)?.name ?? 'Desconhecido',
            }
          : null,
        epoch: epochMap.get(work.epochId) ?? { id: '', name: 'Desconhecida' },
      })),
      totalCount,
      hasMore: skip + works.length < totalCount,
    };
  }

  private async getCatalogWithFilters(
    page: number,
    limit: number,
    query: GetWorksCatalogQueryDto,
  ): Promise<WorksCatalogResponseDto> {
    const skip = (page - 1) * limit;

    if (query.search) {
      const byText = await this.searchCatalogByText(query, skip, limit);
      if (byText) {
        return byText;
      }
    }

    const whereClause = await this.buildCatalogWhereClause(query);

    const [works, totalCount] = await Promise.all([
      this.prisma.work.findMany({
        where: whereClause,
        select: WORK_CATALOG_FALLBACK_SELECT,
        // O desempate por `id` torna a paginação estável: só com `title` duas
        // obras homônimas trocam de lugar entre páginas e uma delas some.
        orderBy: [{ title: 'asc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.work.count({ where: whereClause }),
    ]);

    return {
      works: works.map((work) => this.toCatalogItemDto(work)),
      totalCount,
      hasMore: skip + works.length < totalCount,
    };
  }

  /**
   * A busca do catálogo pelo índice de texto.
   *
   * **O problema.** O caminho antigo casa o termo com `contains` em três campos
   * de texto. `contains` com `mode: 'insensitive'` vira `$regex` insensível a
   * maiúsculas, que não usa índice B-tree no MongoDB: cada busca varre as 207
   * mil obras — duas vezes, porque a lista e a contagem são consultas
   * separadas. Medido aqui: 281 ms só a contagem de "chopin", ~1,2 s a rota.
   *
   * **A troca.** `$text` usa o índice `work_text_search` (título, subtítulo e
   * número de catálogo, com pesos — ver `TextIndexService`), e `$unionWith`
   * junta, no mesmo pipeline, as obras dos compositores que casam com o termo.
   * `$facet` devolve a página e o total num round-trip só. Medido: "chopin" 17
   * ms (252 obras), "sonata" 67 ms (9.717), "op" 283 ms (58.916) — contra ~1,2
   * s antes.
   *
   * **Onde ainda cai no regex.** `$text` casa palavras, não pedaços de palavra:
   * "beeth" não encontra "Beethoven". Quando o pipeline não devolve nada — e só
   * então — a busca volta ao caminho antigo, que continua correto. É por isso
   * que esta função devolve `null` em vez de uma resposta vazia.
   */
  private async searchCatalogByText(
    query: GetWorksCatalogQueryDto,
    skip: number,
    limit: number,
  ): Promise<WorksCatalogResponseDto | null> {
    const term = query.search?.trim();

    if (!term || !this.textIndex.hasTextIndex('Work')) {
      return null;
    }

    const baseFilter = this.toRawCatalogFilter(query);
    const composerIds = await this.findComposerIdsByTerm(term);

    try {
      const result = await this.prisma.work.aggregateRaw({
        pipeline: [
          // `$text` só é aceito no primeiro estágio do pipeline e nunca dentro
          // de um `$or` com outras condições — daí o `$unionWith` para o ramo
          // do compositor em vez de um `$or`.
          { $match: { ...baseFilter, $text: { $search: term } } },
          { $project: { title: 1 } },
          ...(composerIds.length > 0
            ? [
                {
                  $unionWith: {
                    coll: 'Work',
                    pipeline: [
                      {
                        $match: {
                          ...baseFilter,
                          composerId: {
                            $in: composerIds.map((id) => ({ $oid: id })),
                          },
                        },
                      },
                      { $project: { title: 1 } },
                    ],
                  },
                },
              ]
            : []),
          // Uma obra pode vir pelos dois ramos (título com o nome do
          // compositor): `$group` mantém uma ocorrência só.
          { $group: { _id: '$_id', title: { $first: '$title' } } },
          {
            $facet: {
              rows: [
                { $sort: { title: 1, _id: 1 } },
                { $skip: skip },
                { $limit: limit },
                { $project: { _id: 1 } },
              ],
              total: [{ $count: 'value' }],
            },
          },
        ],
        options: { allowDiskUse: true, maxTimeMS: SEARCH_MAX_TIME_MS },
      });

      const [page] = result as unknown as Array<{
        rows: Array<{ _id: { $oid?: string } | string }>;
        total: Array<{ value: number }>;
      }>;

      const totalCount = page?.total?.[0]?.value ?? 0;

      if (totalCount === 0) {
        return null;
      }

      const ids = (page?.rows ?? [])
        .map((row) =>
          typeof row._id === 'string' ? row._id : (row._id.$oid ?? ''),
        )
        .filter(Boolean);

      const works = await this.loadCatalogItemsByIds(ids);

      return {
        works,
        totalCount,
        hasMore: skip + works.length < totalCount,
      };
    } catch (error: unknown) {
      this.logger.warn(
        `Busca do catálogo por índice de texto falhou, usando regex: ${errorMessage(error)}`,
      );
      return null;
    }
  }

  /**
   * Carrega as obras de uma página já escolhida, na ordem em que vieram.
   * `findMany` com `in` devolve na ordem do banco, não na dos ids.
   */
  private async loadCatalogItemsByIds(
    ids: string[],
  ): Promise<WorkCatalogItemDto[]> {
    if (ids.length === 0) {
      return [];
    }

    const works = await this.prisma.work.findMany({
      where: { id: { in: ids } },
      select: WORK_CATALOG_FALLBACK_SELECT,
    });

    const byId = new Map(works.map((work) => [work.id, work]));

    return ids
      .map((id) => byId.get(id))
      .filter((work): work is (typeof works)[number] => work !== undefined)
      .map((work) => this.toCatalogItemDto(work));
  }

  /**
   * Os ids dos compositores que casam com o termo, pelo índice de texto de
   * `Composer` e, se ele não devolver nada, pelo regex de antes — a mesma
   * regra de queda do catálogo de obras.
   */
  private async findComposerIdsByTerm(term: string): Promise<string[]> {
    if (this.textIndex.hasTextIndex('Composer')) {
      try {
        const result = await this.prisma.composer.aggregateRaw({
          pipeline: [
            { $match: { $text: { $search: term } } },
            { $limit: SEARCH_COMPOSER_CAP },
            { $project: { _id: 1 } },
          ],
          options: { maxTimeMS: SEARCH_MAX_TIME_MS },
        });

        const rows = result as unknown as Array<{
          _id: { $oid?: string } | string;
        }>;

        const ids = rows
          .map((row) =>
            typeof row._id === 'string' ? row._id : (row._id.$oid ?? ''),
          )
          .filter(Boolean);

        if (ids.length > 0) {
          return ids;
        }
      } catch (error: unknown) {
        this.logger.warn(
          `Busca de compositor por índice de texto falhou, usando regex: ${errorMessage(error)}`,
        );
      }
    }

    const contains = {
      contains: escapeRegex(term),
      mode: 'insensitive' as const,
    };

    const composers = await this.prisma.composer.findMany({
      where: { OR: [{ name: contains }, { fullName: contains }] },
      select: { id: true },
      take: SEARCH_COMPOSER_CAP,
    });

    return composers.map((composer) => composer.id);
  }

  /**
   * Os filtros do catálogo no dialeto do MongoDB.
   *
   * `aggregateRaw` não passa pelo tradutor do Prisma: chave estrangeira precisa
   * de `{ $oid }` e `has` sobre lista vira igualdade — o Mongo casa um valor
   * escalar contra qualquer elemento do array.
   */
  private toRawCatalogFilter(
    query: GetWorksCatalogQueryDto,
  ): Record<string, unknown> {
    const filter: Record<string, unknown> = {};

    if (query.composerId) filter.composerId = { $oid: query.composerId };
    if (query.instrumentId) filter.instrumentId = { $oid: query.instrumentId };
    if (query.epochId) filter.epochId = { $oid: query.epochId };
    if (query.difficultyLevel) filter.difficultyLevel = query.difficultyLevel;
    if (query.categoryNames) filter.categoryNames = query.categoryNames;
    if (query.workGenresArr) filter.workGenresArr = query.workGenresArr;

    return filter;
  }

  /**
   * O caminho antigo da busca, hoje reservado a quem o índice de texto não
   * atende: termo parcial ("beeth") ou instância sem o índice criado.
   *
   * O termo vale para título, subtítulo, catálogo e nome do compositor. O
   * compositor entra pelos ids dele, resolvidos antes: filtrar pela relação
   * (`composer: { name: … }`) faz o Prisma montar um `$lookup` em cada uma das
   * ~200 mil obras — ~18 s por consulta, e o catálogo faz duas (lista e
   * contagem). Mesmo resultado e mesma ordem, medido em 13/09 ("chopin": 249
   * obras, de 20,3 s para 1,2 s).
   */
  private async buildCatalogWhereClause(query: GetWorksCatalogQueryDto) {
    const whereClause: Record<string, unknown> = {};

    if (query.composerId) whereClause.composerId = query.composerId;
    if (query.instrumentId) whereClause.instrumentId = query.instrumentId;
    if (query.epochId) whereClause.epochId = query.epochId;
    if (query.difficultyLevel)
      whereClause.difficultyLevel = query.difficultyLevel;
    if (query.categoryNames)
      whereClause.categoryNames = { has: query.categoryNames };
    if (query.workGenresArr)
      whereClause.workGenresArr = { has: query.workGenresArr };

    if (query.search) {
      const contains = {
        contains: escapeRegex(query.search),
        mode: 'insensitive' as const,
      };
      const composerIds = await this.findComposerIdsByTerm(query.search);

      const searchConditions = [
        { title: contains },
        { subtitle: contains },
        { opOrCatalog: contains },
        ...(composerIds.length > 0
          ? [{ composerId: { in: composerIds } }]
          : []),
      ];

      if (Object.keys(whereClause).length > 0) {
        return {
          AND: [{ ...whereClause }, { OR: searchConditions }],
        };
      }

      return { OR: searchConditions };
    }

    return whereClause;
  }

  private toCatalogItemDto(work: {
    id: string;
    title: string;
    subtitle: string | null;
    opOrCatalog: string | null;
    compositionYear: string | null;
    tone: string | null;
    mediaDuration: string | null;
    workType: string;
    isVerified: boolean;
    composer: {
      id: string;
      name: string;
      fullName: string | null;
      epochName: string | null;
    };
    instrument: { name: string } | null;
    epoch: { id: string; name: string } | null;
  }): WorkCatalogItemDto {
    return {
      id: work.id,
      title: work.title,
      subtitle: this.normalizeOptionalString(work.subtitle),
      opOrCatalog: this.normalizeOptionalString(work.opOrCatalog),
      compositionYear: this.normalizeOptionalString(work.compositionYear),
      tone: this.normalizeOptionalString(work.tone),
      mediaDuration: this.normalizeOptionalString(work.mediaDuration),
      workType: work.workType,
      isVerified: work.isVerified,
      composer: {
        id: work.composer.id,
        name: work.composer.name,
        fullName: work.composer.fullName,
        epochName: work.composer.epochName,
      },
      instrument: work.instrument,
      epoch: work.epoch ?? { id: '', name: 'Desconhecida' },
    };
  }

  private async getCachedTotalWorkCount(): Promise<number> {
    return this.appCache.remember(
      `${CacheNamespace.WORKS}:catalog:v1:total-count`,
      {
        ttlMs: WORK_CATALOG_CACHE_TTL_MS.NONE,
        hotTtlMs: WORK_HOT_CACHE_TTL_MS,
      },
      () => this.prisma.work.count(),
    );
  }

  private toFilterOptionItem(item: {
    id: string;
    name: string;
    originalName?: string | null;
  }): WorkFilterOptionItemDto {
    return {
      id: item.id,
      name: item.name,
      originalName: item.originalName ?? undefined,
    };
  }

  private toPopularComposerFilter(composer: {
    id: string;
    name: string;
    fullName: string | null;
    _count: { works: number };
  }): PopularComposerFilterDto {
    return {
      id: composer.id,
      name: composer.name,
      fullName: composer.fullName ?? undefined,
      worksCount: composer._count.works,
    };
  }

  /** Lista completa de gêneros de obra — diferente de `filter-options`, que só
   * traz os 30 mais usados para o catálogo geral. */
  async getAllGenres(): Promise<WorkGenreItemDto[]> {
    return this.appCache.remember(
      `${CacheNamespace.WORKS}:genres:all:v1`,
      {
        ttlMs: WORK_GENRES_TTL_MS,
        hotTtlMs: WORK_HOT_CACHE_TTL_MS,
        metricRoute: 'works/genres',
      },
      () =>
        this.prisma.workGenre.findMany({
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
    );
  }

  /** Autocomplete de gêneros — usado no formulário de upload de obra. */
  async searchGenres(
    query: SearchWorkGenresQueryDto,
  ): Promise<WorkGenreItemDto[]> {
    const term = query.q?.trim();
    const limit = Math.min(query.limit ?? 20, 50);

    return this.prisma.workGenre.findMany({
      where: term
        ? { name: { contains: escapeRegex(term), mode: 'insensitive' } }
        : undefined,
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: limit,
    });
  }

  /** Obras relacionadas por compositor e/ou instrumento — seção "obras
   * relacionadas" da página de detalhe. */
  async findRelated(workId: string, limit = 6): Promise<RelatedWorkItemDto[]> {
    return this.appCache.remember(
      `${CacheNamespace.WORKS}:related:${workId}:${limit}`,
      {
        ttlMs: WORK_RELATED_TTL_MS,
        hotTtlMs: WORK_HOT_CACHE_TTL_MS,
        metricRoute: 'works/related',
      },
      () => this.loadRelated(workId, limit),
    );
  }

  private async loadRelated(
    workId: string,
    limit: number,
  ): Promise<RelatedWorkItemDto[]> {
    const work = await this.prisma.work.findUnique({
      where: { id: workId },
      select: { composerId: true, instrumentId: true },
    });

    if (!work) {
      throw new NotFoundException(`Obra com id "${workId}" não encontrada`);
    }

    const relatedWorks = await this.prisma.work.findMany({
      where: {
        AND: [
          { id: { not: workId } },
          {
            OR: [
              { composerId: work.composerId },
              ...(work.instrumentId
                ? [{ instrumentId: work.instrumentId }]
                : []),
            ],
          },
        ],
      },
      select: {
        id: true,
        title: true,
        opOrCatalog: true,
        compositionYear: true,
        tone: true,
        mediaDuration: true,
        workType: true,
        instrument: { select: { name: true } },
        composer: { select: { id: true, name: true, epochName: true } },
      },
      orderBy: { title: 'asc' },
      take: limit,
    });

    return relatedWorks.map((related) => ({
      id: related.id,
      title: related.title,
      opOrCatalog: this.normalizeOptionalString(related.opOrCatalog) ?? null,
      compositionYear:
        this.normalizeOptionalString(related.compositionYear) ?? null,
      tone: this.normalizeOptionalString(related.tone) ?? null,
      mediaDuration:
        this.normalizeOptionalString(related.mediaDuration) ?? null,
      workType: related.workType,
      composer: related.composer,
      instrument: related.instrument,
    }));
  }

  /**
   * Atualiza os campos de mídia de uma obra (Spotify, YouTube, áudio
   * customizado, vídeo aula). Só o autor da obra (`createdBy`) ou um admin
   * (`role >= 1`) pode editar — mesma regra do legado.
   */
  async updateMedia(
    workId: string,
    userId: string,
    isAdmin: boolean,
    dto: UpdateWorkMediaDto,
  ): Promise<WorkMediaResponseDto> {
    const work = await this.assertMediaPermission(workId, userId, isAdmin);

    const data: Prisma.WorkUpdateInput = {};

    if (dto.spotifyTrackId) {
      data.spotifyTrackId = dto.spotifyTrackId;
      data.spotifyTrackUrl = dto.spotifyTrackUrl;
      data.spotifyDisplayTitle = dto.spotifyDisplayTitle ?? null;
      data.spotifyDuration = dto.spotifyDuration ?? null;
      data.spotifyArtists =
        (dto.spotifyArtists as Prisma.InputJsonValue) ?? undefined;
      data.spotifyThumbnail = dto.spotifyThumbnail ?? null;
    }

    if (dto.youtubeVideoId) {
      data.youtubeVideoId = dto.youtubeVideoId;
      data.youtubeVideoUrl = dto.youtubeVideoUrl;
      data.youtubeTitle = dto.youtubeTitle;
    }

    if (dto.customAudioFile) {
      data.customAudioFile = dto.customAudioFile;
      data.customAudioUrl = dto.customAudioFile;
      data.customAudioSource = dto.customAudioSource ?? 'upload';
      data.customAudioMetadata =
        (dto.customAudioMetadata as Prisma.InputJsonValue) ?? undefined;
    } else if (dto.customAudioUrl) {
      data.customAudioUrl = dto.customAudioUrl;
      data.customAudioSource = dto.customAudioSource ?? 'alternative';
      data.customAudioMetadata =
        (dto.customAudioMetadata as Prisma.InputJsonValue) ?? undefined;

      if (!work.customAudioFile || work.customAudioSource !== 'upload') {
        data.customAudioFile = null;
      }
    }

    if (dto.removeCustomAudio) {
      data.customAudioFile = null;
      data.customAudioUrl = null;
      data.customAudioSource = null;
      data.customAudioMetadata = null;
    }

    if (dto.videoAulaFile || dto.videoAulaUrl) {
      data.videoAulaUrl = dto.videoAulaUrl ?? null;
      data.videoAulaFile = dto.videoAulaFile ?? null;
      data.videoAulaTitle = dto.videoAulaTitle ?? work.title;
      data.videoAulaType = dto.videoAulaType ?? 'video';
      data.videoAulaSource = dto.videoAulaSource ?? 'youtube';
      data.videoAulaAddedBy = userId;
      data.videoAulaAddedAt = new Date();
      data.videoAulaMetadata =
        (dto.videoAulaMetadata as Prisma.InputJsonValue) ?? undefined;
    }

    if (dto.mediaSource) {
      data.mediaSource = dto.mediaSource;
    }

    const updatedFields = Object.keys(data);
    if (updatedFields.length === 0) {
      throw new BadRequestException('Nenhum campo de mídia para atualizar');
    }

    const updated = await this.prisma.work.update({
      where: { id: workId },
      data,
    });

    await this.invalidateWorkDetailCache(workId);

    return {
      success: true,
      updatedFields,
      audioInfo: {
        hasCustomAudio: !!(updated.customAudioUrl || updated.customAudioFile),
        audioSource: updated.customAudioSource,
        audioUrl: updated.customAudioUrl,
        audioFile: updated.customAudioFile,
      },
    };
  }

  /** Remove um tipo específico de mídia da obra (spotify/youtube/custom-audio/video-aula). */
  async clearMedia(
    workId: string,
    userId: string,
    isAdmin: boolean,
    mediaType: 'spotify' | 'youtube' | 'custom-audio' | 'video-aula',
  ): Promise<{ success: true; clearedFields: string[] }> {
    await this.assertMediaPermission(workId, userId, isAdmin);

    // O arquivo enviado pela API sai junto com o campo — antes só saía quando
    // a obra era apagada.
    const fileKind =
      mediaType === 'custom-audio'
        ? StorageAssetKind.WORK_AUDIO
        : mediaType === 'video-aula'
          ? StorageAssetKind.WORK_VIDEO_LESSON
          : null;
    const current = fileKind
      ? await this.prisma.work.findUnique({
          where: { id: workId },
          select: { customAudioUrl: true, videoAulaUrl: true },
        })
      : null;

    const data: Prisma.WorkUpdateInput = {};

    switch (mediaType) {
      case 'spotify':
        data.spotifyTrackId = null;
        data.spotifyTrackUrl = null;
        data.spotifyDisplayTitle = null;
        data.spotifyDuration = null;
        data.spotifyArtists = null;
        data.spotifyThumbnail = null;
        break;
      case 'youtube':
        data.youtubeVideoId = null;
        data.youtubeVideoUrl = null;
        data.youtubeTitle = null;
        break;
      case 'custom-audio':
        data.customAudioUrl = null;
        data.customAudioFile = null;
        data.customAudioSource = null;
        data.customAudioMetadata = null;
        break;
      case 'video-aula':
        data.videoAulaUrl = null;
        data.videoAulaFile = null;
        data.videoAulaTitle = null;
        data.videoAulaType = null;
        data.videoAulaSource = null;
        break;
    }

    await this.prisma.work.update({ where: { id: workId }, data });
    await this.invalidateWorkDetailCache(workId);

    if (fileKind) {
      await this.deleteMediaFile(
        fileKind === StorageAssetKind.WORK_AUDIO
          ? current?.customAudioUrl
          : current?.videoAulaUrl,
        fileKind,
      );
    }

    return { success: true, clearedFields: Object.keys(data) };
  }

  /**
   * Apaga do armazenamento o arquivo de mídia que saiu da obra. Arquivo que
   * não foi enviado pela API (link externo, disco do legado) não tem registro
   * e fica como está. Falha no provedor não desfaz a limpeza do campo: o
   * arquivo vira órfão, e a varredura o acha.
   */
  private async deleteMediaFile(
    url: string | null | undefined,
    kind: StorageAssetKind,
  ): Promise<void> {
    if (!url) return;

    const asset = await this.prisma.storedAsset.findFirst({
      where: {
        kind,
        secureUrl: url,
        status: { not: StorageAssetStatus.DELETED },
      },
      select: { id: true },
    });

    if (!asset) return;

    try {
      await this.storage.deleteAsset(asset.id);
    } catch (error) {
      this.logger.warn(
        `Arquivo de mídia ${asset.id} não foi apagado: ${errorMessage(error)}`,
      );
    }
  }

  private async assertMediaPermission(
    workId: string,
    userId: string,
    isAdmin: boolean,
  ): Promise<{
    title: string;
    createdBy: string | null;
    customAudioFile: string | null;
    customAudioSource: string | null;
  }> {
    const work = await this.prisma.work.findUnique({
      where: { id: workId },
      select: {
        title: true,
        createdBy: true,
        customAudioFile: true,
        customAudioSource: true,
      },
    });

    if (!work) {
      throw new NotFoundException(`Obra com id "${workId}" não encontrada`);
    }

    if (!isAdmin && work.createdBy !== userId) {
      throw new ForbiddenException(
        'Você não tem permissão para editar a mídia desta obra',
      );
    }

    return work;
  }

  private async invalidateWorkDetailCache(workId: string): Promise<void> {
    await this.appCache.del(workDetailCacheKey(workId));
  }

  /**
   * Lista as partituras (`WorkScore`) de uma obra. Suporta o modo de busca
   * geral (paginação simples) e o modo `limitPerType` (pagina cada categoria
   * independentemente, mesma lógica da rota legada `work-scores`), além da
   * busca direta por `sourceId`+`source` (que incrementa o contador de acesso).
   */
  async getScores(
    workId: string,
    query: GetWorkScoresQueryDto,
  ): Promise<WorkScoresResponseDto> {
    // Obra sem partitura guardada: lê do IMSLP uma vez (ver ImslpScoresService).
    // Só na listagem — a busca por `sourceId` é de partitura que já existe.
    if (!query.sourceId) {
      await this.imslpScores.ensure(workId);
    }

    if (query.sourceId && query.source) {
      const score = await this.prisma.workScore.findFirst({
        where: {
          workId,
          sourceId: query.sourceId,
          source: query.source,
          isActive: true,
        },
        orderBy: [{ accessCount: 'desc' }, { createdAt: 'desc' }],
      });

      if (!score) {
        return { scores: [], total: 0, hasMore: false };
      }

      await this.prisma.workScore.update({
        where: { id: score.id },
        data: { lastAccessed: new Date(), accessCount: { increment: 1 } },
      });

      return {
        scores: [this.toWorkScoreItemDto(score)],
        total: 1,
        hasMore: false,
      };
    }

    const baseWhere: Prisma.WorkScoreWhereInput = {
      workId,
      isActive: true,
      ...(query.source ? { source: query.source } : {}),
    };

    if (query.limitPerType && query.limitPerType > 0) {
      const limitPerType = query.limitPerType;
      const offset = query.offset ?? 0;

      const allScores = await this.prisma.workScore.findMany({
        where: baseWhere,
        orderBy: [{ accessCount: 'desc' }, { createdAt: 'desc' }],
      });

      const byBucket = new Map<string, typeof allScores>();
      for (const score of allScores) {
        const bucket = classifyScoreBucket(score);
        const list = byBucket.get(bucket) ?? [];
        list.push(score);
        byBucket.set(bucket, list);
      }

      const round = Math.floor(offset / limitPerType);
      const currentOffset = round * limitPerType;

      const selected: typeof allScores = [];
      const totalByType: Record<string, number> = {};
      let hasMore = false;

      for (const bucket of [
        'scores',
        'parts',
        'arrangements',
        'uploads',
        'librettos',
        'others',
      ]) {
        const scoresOfBucket = byBucket.get(bucket) ?? [];
        totalByType[bucket] = scoresOfBucket.length;

        const page = scoresOfBucket.slice(
          currentOffset,
          currentOffset + limitPerType,
        );
        selected.push(...page);

        if (currentOffset + page.length < scoresOfBucket.length) {
          hasMore = true;
        }
      }

      return {
        scores: selected.map((score) => this.toWorkScoreItemDto(score)),
        total: allScores.length,
        hasMore,
        totalByType,
      };
    }

    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const [scores, total] = await Promise.all([
      this.prisma.workScore.findMany({
        where: baseWhere,
        orderBy: [{ accessCount: 'desc' }, { createdAt: 'desc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.workScore.count({ where: baseWhere }),
    ]);

    return {
      scores: scores.map((score) => this.toWorkScoreItemDto(score)),
      total,
      hasMore: offset + scores.length < total,
    };
  }

  private toWorkScoreItemDto(score: {
    id: string;
    source: string;
    sourceId: string;
    title: string;
    downloadUrl: string | null;
    thumbnailUrl: string | null;
    fileSize: string | null;
    pageCount: string | null;
    fileFormat: string;
    type: string;
    groupIndex: number | null;
    groupTitle: string | null;
    editor: string | null;
    publisher: string | null;
  }): WorkScoreItemDto {
    return {
      id: score.id,
      source: score.source,
      sourceId: score.sourceId,
      title: score.title,
      downloadUrl: this.normalizeOptionalString(score.downloadUrl) ?? null,
      thumbnailUrl: this.normalizeOptionalString(score.thumbnailUrl) ?? null,
      fileSize: this.normalizeOptionalString(score.fileSize) ?? null,
      pageCount: this.normalizeOptionalString(score.pageCount) ?? null,
      fileFormat: score.fileFormat,
      type: score.type,
      groupIndex: score.groupIndex ?? null,
      groupTitle: this.normalizeOptionalString(score.groupTitle) ?? null,
      editor: this.normalizeOptionalString(score.editor) ?? null,
      publisher: this.normalizeOptionalString(score.publisher) ?? null,
    };
  }
}
