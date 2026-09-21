import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Cache } from 'cache-manager';
import { CacheNamespace } from '../../common/cache/cache-keys';
import { escapeRegex } from '../../common/utils/regex.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  InstrumentShowcaseItemDto,
  ShowcaseTopComposerDto,
  ShowcaseWorkDto,
} from './dto/instrument-showcase.dto';
import { InstrumentItemDto } from './dto/instrument-item.dto';
import { InstrumentStatsResponseDto } from './dto/instrument-stats-response.dto';
import {
  SHOWCASE_COMPOSER_PREFERENCES,
  SHOWCASE_INSTRUMENTS,
  SHOWCASE_MAX_WORKS,
  SHOWCASE_TOP_COMPOSERS,
  SHOWCASE_WORKS_PREFERENCES,
} from './instrument-showcase.config';
import type { ShowcaseComposerPreference } from './instrument-showcase.config';

const INSTRUMENTS_CACHE_KEY = `${CacheNamespace.INSTRUMENTS}:list`;
const INSTRUMENTS_TTL_MS = 6 * 60 * 60 * 1000;
const INSTRUMENT_STATS_TTL_MS = 15 * 60 * 1000;
const INSTRUMENTS_SHOWCASE_CACHE_KEY = `${CacheNamespace.INSTRUMENTS}:showcase:v1`;
const INSTRUMENTS_SHOWCASE_TTL_MS = 6 * 60 * 60 * 1000;

const SHOWCASE_COMPOSER_SELECT = {
  id: true,
  name: true,
  fullName: true,
  portraitUrl: true,
  epochName: true,
} as const;

const SHOWCASE_WORK_SELECT = {
  id: true,
  title: true,
  opOrCatalog: true,
  compositionYear: true,
  tone: true,
  mediaDuration: true,
  imslpPermlink: true,
  videoUrl: true,
  composer: { select: SHOWCASE_COMPOSER_SELECT },
} as const;

const SHOWCASE_WORK_ORDER: Prisma.WorkOrderByWithRelationInput[] = [
  { compositionYear: 'asc' },
  { title: 'asc' },
];

@Injectable()
export class InstrumentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async findAll(): Promise<InstrumentItemDto[]> {
    const cached = await this.cacheManager.get<InstrumentItemDto[]>(
      INSTRUMENTS_CACHE_KEY,
    );

    if (cached) {
      return cached;
    }

    const instruments = await this.prisma.instrument.findMany({
      select: {
        id: true,
        name: true,
        category: true,
        difficulty: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    const response = instruments.map((instrument) => ({
      id: instrument.id,
      name: instrument.name,
      category: this.normalizeOptionalString(instrument.category) ?? null,
      difficulty: this.normalizeOptionalString(instrument.difficulty) ?? null,
    }));

    await this.cacheManager.set(
      INSTRUMENTS_CACHE_KEY,
      response,
      INSTRUMENTS_TTL_MS,
    );

    return response;
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

  /** Estatísticas de um instrumento — obras cadastradas, usuários que o
   * estudam e os 5 compositores com mais obras para ele. Usado pela página
   * de história do instrumento (o texto histórico descritivo permanece
   * estático no frontend, igual à decisão tomada para épocas). */
  async getStats(instrumentId: string): Promise<InstrumentStatsResponseDto> {
    const cacheKey = `${CacheNamespace.INSTRUMENTS}:${instrumentId}:stats`;
    const cached =
      await this.cacheManager.get<InstrumentStatsResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const instrument = await this.prisma.instrument.findUnique({
      where: { id: instrumentId },
      select: { id: true, name: true },
    });

    if (!instrument) {
      throw new NotFoundException(
        `Instrumento com id "${instrumentId}" não encontrado`,
      );
    }

    // Os 5 compositores com mais obras para o instrumento, contados no banco.
    // Antes eram todas as obras do instrumento trazidas para a memória e
    // contadas aqui — no piano, dezenas de milhares de documentos por acesso.
    const [worksCount, usersCount, topGroups] = await Promise.all([
      this.prisma.work.count({ where: { instrumentId } }),
      this.prisma.userInstrument.count({ where: { instrumentId } }),
      this.prisma.work.groupBy({
        by: ['composerId'],
        where: { instrumentId },
        _count: { composerId: true },
        orderBy: { _count: { composerId: 'desc' } },
        take: 5,
      }),
    ]);

    const composers = await this.prisma.composer.findMany({
      where: { id: { in: topGroups.map((group) => group.composerId) } },
      select: { id: true, name: true, fullName: true, portraitUrl: true },
    });
    const composerById = new Map(composers.map((c) => [c.id, c]));

    const topComposers = topGroups.flatMap((group) => {
      const composer = composerById.get(group.composerId);
      return composer
        ? [
            {
              id: composer.id,
              name: composer.name,
              fullName: composer.fullName,
              portraitUrl: composer.portraitUrl,
              worksCount: group._count.composerId,
            },
          ]
        : [];
    });

    const response: InstrumentStatsResponseDto = {
      instrumentId: instrument.id,
      instrumentName: instrument.name,
      worksCount,
      usersCount,
      topComposers,
    };

    await this.cacheManager.set(cacheKey, response, INSTRUMENT_STATS_TTL_MS);
    return response;
  }

  /**
   * A vitrine da página de instrumentos (`/instruments` no front), pela
   * curadoria de `instrument-showcase.config.ts`: até 20 obras por
   * instrumento, os totais e os compositores de destaque. É a regra que o
   * front aplicava lendo o banco direto; agora a página inteira sai numa
   * chamada, e em cache.
   */
  async getShowcase(): Promise<InstrumentShowcaseItemDto[]> {
    const cached = await this.cacheManager.get<InstrumentShowcaseItemDto[]>(
      INSTRUMENTS_SHOWCASE_CACHE_KEY,
    );
    if (cached) {
      return cached;
    }

    const instruments = await this.prisma.instrument.findMany({
      where: { name: { in: SHOWCASE_INSTRUMENTS, mode: 'insensitive' } },
      select: { id: true, name: true },
    });

    // Na ordem da curadoria; a chave das preferências é o nome da curadoria,
    // casado sem diferenciar maiúsculas com o do banco.
    const showcased = SHOWCASE_INSTRUMENTS.flatMap((key) => {
      const instrument = instruments.find(
        (item) => item.name.toLowerCase() === key.toLowerCase(),
      );
      return instrument ? [{ ...instrument, key }] : [];
    });

    const response = await Promise.all(
      showcased.map((instrument) => this.buildShowcaseItem(instrument)),
    );

    await this.cacheManager.set(
      INSTRUMENTS_SHOWCASE_CACHE_KEY,
      response,
      INSTRUMENTS_SHOWCASE_TTL_MS,
    );
    return response;
  }

  private async buildShowcaseItem(instrument: {
    id: string;
    name: string;
    key: string;
  }): Promise<InstrumentShowcaseItemDto> {
    const preference = SHOWCASE_COMPOSER_PREFERENCES[instrument.key] ?? {};

    const [works, totalWorks, totalUsers, topComposers] = await Promise.all([
      this.selectShowcaseWorks(instrument, preference),
      this.prisma.work.count({ where: { instrumentId: instrument.id } }),
      this.prisma.userInstrument.count({
        where: { instrumentId: instrument.id },
      }),
      this.findShowcaseTopComposers(instrument.id, preference),
    ]);

    return {
      id: instrument.id,
      name: instrument.name,
      works,
      totalWorks,
      totalUsers,
      topComposers,
    };
  }

  /**
   * Com obras escolhidas por compositor: as indicadas por id, depois por
   * título, depois as outras dele até a conta; e o resto do instrumento
   * completa até o máximo. Sem escolha: o compositor em destaque, ou todos
   * menos os excluídos. Sempre em ordem de composição e título.
   */
  private async selectShowcaseWorks(
    instrument: { id: string; key: string },
    preference: ShowcaseComposerPreference,
  ): Promise<ShowcaseWorkDto[]> {
    const findWorks = (where: Prisma.WorkWhereInput, take?: number) =>
      this.prisma.work.findMany({
        where: { instrumentId: instrument.id, ...where },
        select: SHOWCASE_WORK_SELECT,
        orderBy: SHOWCASE_WORK_ORDER,
        take,
      });

    const worksPreference = SHOWCASE_WORKS_PREFERENCES[instrument.key];

    if (!worksPreference?.composerWorks) {
      const composerFilter: Prisma.WorkWhereInput =
        preference.preferredComposerId
          ? { composerId: preference.preferredComposerId }
          : preference.excludedComposerIds?.length
            ? { composerId: { notIn: preference.excludedComposerIds } }
            : {};
      return findWorks(composerFilter, SHOWCASE_MAX_WORKS);
    }

    const selected: ShowcaseWorkDto[] = [];

    for (const [composerId, prefs] of Object.entries(
      worksPreference.composerWorks,
    )) {
      const fromComposer: ShowcaseWorkDto[] = [];

      if (prefs.specificWorkIds?.length) {
        fromComposer.push(
          ...(await findWorks({
            composerId,
            id: { in: prefs.specificWorkIds },
          })),
        );
      }

      if (prefs.specificWorkTitles?.length) {
        fromComposer.push(
          ...(await findWorks({
            composerId,
            OR: prefs.specificWorkTitles.map((title) => ({
              title: { contains: escapeRegex(title), mode: 'insensitive' },
            })),
            id: { notIn: fromComposer.map((work) => work.id) },
          })),
        );
      }

      const remaining = prefs.count - fromComposer.length;
      if (remaining > 0) {
        fromComposer.push(
          ...(await findWorks(
            { composerId, id: { notIn: fromComposer.map((work) => work.id) } },
            remaining,
          )),
        );
      }

      selected.push(...fromComposer);
    }

    if (worksPreference.fallbackToAutomatic !== false) {
      const maxWorks = Math.min(
        worksPreference.totalMaxWorks ?? SHOWCASE_MAX_WORKS,
        SHOWCASE_MAX_WORKS,
      );
      const remaining = maxWorks - selected.length;
      if (remaining > 0) {
        selected.push(
          ...(await findWorks(
            { id: { notIn: selected.map((work) => work.id) } },
            remaining,
          )),
        );
      }
    }

    return selected.slice(0, SHOWCASE_MAX_WORKS);
  }

  /** O compositor em destaque, se houver; senão os 5 com mais obras,
   * contados no banco (como em `getStats`), sem os excluídos. */
  private async findShowcaseTopComposers(
    instrumentId: string,
    preference: ShowcaseComposerPreference,
  ): Promise<ShowcaseTopComposerDto[]> {
    if (preference.preferredComposerId) {
      const [composer, count] = await Promise.all([
        this.prisma.composer.findUnique({
          where: { id: preference.preferredComposerId },
          select: SHOWCASE_COMPOSER_SELECT,
        }),
        this.prisma.work.count({
          where: { instrumentId, composerId: preference.preferredComposerId },
        }),
      ]);

      if (composer) {
        return [{ composer, count }];
      }
    }

    const groups = await this.prisma.work.groupBy({
      by: ['composerId'],
      where: {
        instrumentId,
        ...(preference.excludedComposerIds?.length
          ? { composerId: { notIn: preference.excludedComposerIds } }
          : {}),
      },
      _count: { composerId: true },
      orderBy: { _count: { composerId: 'desc' } },
      take: SHOWCASE_TOP_COMPOSERS,
    });

    const composers = await this.prisma.composer.findMany({
      where: { id: { in: groups.map((group) => group.composerId) } },
      select: SHOWCASE_COMPOSER_SELECT,
    });
    const composerById = new Map(composers.map((c) => [c.id, c]));

    return groups.flatMap((group) => {
      const composer = composerById.get(group.composerId);
      return composer ? [{ composer, count: group._count.composerId }] : [];
    });
  }
}
