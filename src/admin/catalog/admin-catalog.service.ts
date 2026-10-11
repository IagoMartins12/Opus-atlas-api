import { escapeRegex } from '../../common/utils/regex.util';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppCacheService } from '../../common/cache/cache.service';
import { CATALOG_NAMESPACES } from '../../common/cache/cache-keys';
import {
  ListComposersQueryDto,
  ListScoresQueryDto,
  ListWorksQueryDto,
  UpdateComposerDto,
  UpdateScoreDto,
  UpdateWorkDto,
} from './dto/admin-catalog.dto';
import { verificationChange, verificationCore } from './verification';
import { porMes, topPorContagem } from '../metrics/raw-aggregate';
import { WorkCountFiltersService } from './work-count-filters.service';

const COMPOSER_SELECT = {
  id: true,
  name: true,
  fullName: true,
  portraitUrl: true,
  epochName: true,
  epochId: true,
  isVerified: true,
  verifiedBy: true,
  verifiedAt: true,
  verificationNotes: true,
  dataQuality: true,
  nationality: true,
  birthDate: true,
  deathDate: true,
  isCustom: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { works: true } },
} as const;

const WORK_SELECT = {
  id: true,
  title: true,
  subtitle: true,
  opOrCatalog: true,
  workType: true,
  difficultyLevel: true,
  instrumentation: true,
  videoUrl: true,
  isVerified: true,
  verifiedBy: true,
  verifiedAt: true,
  annotationsCount: true,
  isCustom: true,
  createdAt: true,
  composer: { select: { id: true, name: true } },
  epoch: { select: { id: true, name: true } },
  instrument: { select: { id: true, name: true } },
  _count: {
    select: {
      favoriteBy: true,
      learners: true,
      wantToLearners: true,
      cachedScores: true,
    },
  },
} as const;

const SCORE_SELECT = {
  id: true,
  title: true,
  type: true,
  source: true,
  isActive: true,
  downloadUrl: true,
  createdAt: true,
  work: {
    select: {
      id: true,
      title: true,
      composer: { select: { id: true, name: true } },
    },
  },
} as const;

@Injectable()
export class AdminCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly countFilters: WorkCountFiltersService,
    private readonly cache: AppCacheService,
  ) {}

  /**
   * Derruba o cache do catálogo público.
   *
   * **Faltava.** As rotas públicas de compositor e obra são cacheadas, e o
   * painel administrativo escrevia sem invalidar nada: um compositor marcado
   * como verificado continuava aparecendo sem o selo até o TTL expirar, e a
   * pessoa que acabou de clicar via a página antiga. A moderação já
   * invalidava ao apagar conteúdo denunciado; a edição, não.
   */
  private async invalidateComposerCache(): Promise<void> {
    await this.cache.invalidateMany(CATALOG_NAMESPACES);
  }

  // -------------------------------------------------------------------
  // Compositores
  // -------------------------------------------------------------------

  async listComposers(query: ListComposersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const where = await this.composerWhere(query);

    const [rows, total] = await Promise.all([
      this.prisma.composer.findMany({
        where,
        select: COMPOSER_SELECT,
        orderBy: [
          { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
          { id: 'asc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.composer.count({ where }),
    ]);

    const composers = rows.map(({ _count, ...c }) => ({
      ...c,
      worksCount: _count.works,
    }));

    return {
      composers,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  private async composerWhere(
    query: ListComposersQueryDto,
  ): Promise<Prisma.ComposerWhereInput> {
    const search = query.search?.trim();
    const and: Prisma.ComposerWhereInput[] = [];

    if (search) {
      const contem = {
        contains: escapeRegex(search),
        mode: 'insensitive' as const,
      };
      and.push({ OR: [{ name: contem }, { fullName: contem }] });
    }
    if (query.hasBio !== undefined) and.push(texto('bio', query.hasBio));
    if (query.hasBioEn !== undefined) and.push(texto('bioEn', query.hasBioEn));
    if (query.hasPortrait !== undefined) {
      and.push({ hasValidImage: query.hasPortrait });
    }
    if (query.hasDates !== undefined) {
      and.push(
        query.hasDates
          ? { AND: [texto('birthDate', true), texto('deathDate', true)] }
          : { OR: [texto('birthDate', false), texto('deathDate', false)] },
      );
    }
    if (query.nationality?.trim()) {
      and.push({
        nationality: {
          contains: escapeRegex(query.nationality.trim()),
          mode: 'insensitive',
        },
      });
    }
    if (query.createdFrom || query.createdTo) {
      and.push({
        createdAt: {
          ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
          ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
        },
      });
    }

    const porObras = await this.composerIdsByWorkCount(
      query.minWorks,
      query.maxWorks,
    );
    if (porObras) and.push({ id: porObras });

    return {
      ...(query.isVerified !== undefined
        ? { isVerified: query.isVerified }
        : {}),
      ...(query.dataQuality ? { dataQuality: query.dataQuality } : {}),
      ...(query.epochId ? { epochId: query.epochId } : {}),
      ...(query.isCustom !== undefined ? { isCustom: query.isCustom } : {}),
      ...(and.length ? { AND: and } : {}),
    };
  }

  /**
   * "De N a M obras" como filtro de id. Com mínimo acima de zero, são os
   * compositores que aparecem no agrupamento das obras dentro da faixa. Sem
   * mínimo, quem tem zero obra nem aparece no agrupamento — então a faixa
   * vira "todos, menos os que passam do máximo".
   */
  private async composerIdsByWorkCount(
    min?: number,
    max?: number,
  ): Promise<{ in: string[] } | { notIn: string[] } | null> {
    if ((min === undefined || min === 0) && max === undefined) return null;

    if (min && min > 0) {
      const rows = await this.prisma.work.groupBy({
        by: ['composerId'],
        _count: { _all: true },
        having: {
          composerId: {
            _count: {
              gte: min,
              ...(max !== undefined ? { lte: max } : {}),
            },
          },
        },
      });
      return { in: rows.map((r) => r.composerId) };
    }

    const acima = await this.prisma.work.groupBy({
      by: ['composerId'],
      _count: { _all: true },
      having: { composerId: { _count: { gt: max } } },
    });
    return { notIn: acima.map((r) => r.composerId) };
  }

  /**
   * O que o detalhe do compositor mostra além do cadastro: o tamanho da obra
   * dele no catálogo, quanto as pessoas usam essas obras e quem cadastrou.
   */
  async composerSummary(composerId: string) {
    const composer = await this.prisma.composer.findUnique({
      where: { id: composerId },
      select: {
        id: true,
        bio: true,
        bioEn: true,
        alternativeNames: true,
        wikipediaLink: true,
        permLinkImslp: true,
        dataSource: true,
        dataCompleteness: true,
        startingWorkIds: true,
        createdByUser: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
    if (!composer) throw new NotFoundException('Compositor não encontrado');

    // Os ids das obras primeiro: contar favoritos "pela relação" (`work: {
    // composerId }`) faz o Mongo cruzar coleções inteiras — 5 s por
    // compositor. Com a lista de ids, cada contagem usa o índice de `workId`.
    const ids = (
      await this.prisma.work.findMany({
        where: { composerId },
        select: { id: true },
      })
    ).map((w) => w.id);
    const porObra = { workId: { in: ids } };
    const oids = ids.map((id) => ({ $oid: id }));

    const [verified, scores, favoritos, aprendidas, querem, maisFavoritadas] =
      await Promise.all([
        this.prisma.work.count({ where: { composerId, isVerified: true } }),
        this.prisma.workScore.count({ where: porObra }),
        this.prisma.favoriteWork.count({ where: porObra }),
        this.prisma.learned.count({ where: porObra }),
        this.prisma.wantToLearn.count({ where: porObra }),
        ids.length
          ? topPorContagem(this.prisma, 'FavoriteWork', 'workId', {
              limite: 5,
              match: { workId: { $in: oids } },
            })
          : Promise.resolve([]),
      ]);

    // As cinco mais favoritadas; sem favoritos, as primeiras do catálogo.
    const topoIds = maisFavoritadas.length
      ? maisFavoritadas.map((r) => r.id)
      : ids.slice(0, 5);
    const topoObras = await this.prisma.work.findMany({
      where: { id: { in: topoIds } },
      select: {
        id: true,
        title: true,
        isVerified: true,
        _count: { select: { favoriteBy: true, cachedScores: true } },
      },
    });
    const works = ids.length;
    const topo = topoIds
      .map((id) => topoObras.find((w) => w.id === id))
      .filter((w): w is (typeof topoObras)[number] => !!w);

    const { createdByUser, startingWorkIds, ...resto } = composer;
    return {
      ...resto,
      startingWorks: await this.startingWorks(startingWorkIds),
      bioLength: composer.bio?.length ?? 0,
      bioEnLength: composer.bioEn?.length ?? 0,
      createdBy: createdByUser
        ? {
            id: createdByUser.id,
            name:
              [createdByUser.firstName, createdByUser.lastName]
                .filter(Boolean)
                .join(' ') || createdByUser.email,
          }
        : null,
      counts: {
        works,
        verifiedWorks: verified,
        scores,
        favoritos,
        aprendidas,
        querem,
      },
      topWorks: topo.map((w) => ({
        id: w.id,
        title: w.title,
        isVerified: w.isVerified,
        favorites: w._count.favoriteBy,
        scores: w._count.cachedScores,
      })),
    };
  }

  /**
   * "Por onde começar" escolhido pela equipe: só obras do próprio compositor,
   * sem repetir, até três. Lista vazia volta tudo ao automático.
   */
  async setStartingWorks(composerId: string, workIds: string[]) {
    const ids = [...new Set(workIds)];
    const composer = await this.prisma.composer.findUnique({
      where: { id: composerId },
      select: { id: true },
    });
    if (!composer) throw new NotFoundException('Compositor não encontrado');

    const own = await this.prisma.work.count({
      where: { id: { in: ids }, composerId },
    });
    if (own !== ids.length) {
      throw new BadRequestException(
        'Escolha só obras deste compositor para "Por onde começar".',
      );
    }

    await this.prisma.composer.update({
      where: { id: composerId },
      data: { startingWorkIds: ids },
    });
    await this.invalidateComposerCache();
    return this.startingWorks(ids);
  }

  /** As obras escolhidas, na ordem escolhida. */
  private async startingWorks(ids: string[]) {
    if (!ids.length) return [];
    const works = await this.prisma.work.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true, opOrCatalog: true },
    });
    return ids
      .map((id) => works.find((w) => w.id === id))
      .filter((w): w is (typeof works)[number] => !!w);
  }

  /** Um compositor, no mesmo formato da lista (para abrir de qualquer tela). */
  async getComposer(id: string) {
    const c = await this.prisma.composer.findUnique({
      where: { id },
      select: COMPOSER_SELECT,
    });
    if (!c) throw new NotFoundException('Compositor não encontrado');
    const { _count, ...resto } = c;
    return { ...resto, worksCount: _count.works };
  }

  /** Uma obra, no mesmo formato da lista. */
  async getWork(id: string) {
    const w = await this.prisma.work.findUnique({
      where: { id },
      select: WORK_SELECT,
    });
    if (!w) throw new NotFoundException('Obra não encontrada');
    const { _count, ...resto } = w;
    return {
      ...resto,
      counts: {
        favorites: _count.favoriteBy,
        learned: _count.learners,
        wantToLearn: _count.wantToLearners,
        scores: _count.cachedScores,
      },
    };
  }

  /** Uma partitura, no mesmo formato da lista. */
  async getScore(id: string) {
    const sc = await this.prisma.workScore.findUnique({
      where: { id },
      select: SCORE_SELECT,
    });
    if (!sc) throw new NotFoundException('Partitura não encontrada');
    return sc;
  }

  /**
   * Quem favoritou, quer aprender ou aprendeu uma obra — uma linha por
   * pessoa, com a data, para abrir a conta a partir da obra.
   */
  async workPeople(
    workId: string,
    kind: 'favoritos' | 'quero-aprender' | 'aprendidas',
    page = 1,
    limit = 20,
  ) {
    const pessoa = {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        email: true,
        image: true,
      },
    } as const;
    const skip = (page - 1) * limit;
    const where = { workId };

    const [linhas, total] =
      kind === 'favoritos'
        ? await Promise.all([
            this.prisma.favoriteWork
              .findMany({
                where,
                orderBy: { id: 'desc' },
                skip,
                take: limit,
                select: { id: true, createdAt: true, user: pessoa },
              })
              .then((r) =>
                r.map((x) => ({
                  id: x.id,
                  em: x.createdAt,
                  user: x.user,
                  detalhe: null,
                })),
              ),
            this.prisma.favoriteWork.count({ where }),
          ])
        : kind === 'quero-aprender'
          ? await Promise.all([
              this.prisma.wantToLearn
                .findMany({
                  where,
                  orderBy: { addedAt: 'desc' },
                  skip,
                  take: limit,
                  select: {
                    id: true,
                    addedAt: true,
                    progress: true,
                    user: pessoa,
                  },
                })
                .then((r) =>
                  r.map((x) => ({
                    id: x.id,
                    em: x.addedAt,
                    user: x.user,
                    detalhe: x.progress
                      ? `${Math.round(x.progress)}% do caminho`
                      : null,
                  })),
                ),
              this.prisma.wantToLearn.count({ where }),
            ])
          : await Promise.all([
              this.prisma.learned
                .findMany({
                  where,
                  orderBy: { learnedAt: 'desc' },
                  skip,
                  take: limit,
                  select: {
                    id: true,
                    learnedAt: true,
                    mastery: true,
                    user: pessoa,
                  },
                })
                .then((r) =>
                  r.map((x) => ({
                    id: x.id,
                    em: x.learnedAt,
                    user: x.user,
                    detalhe: `domínio ${x.mastery}%`,
                  })),
                ),
              this.prisma.learned.count({ where }),
            ]);

    return {
      kind,
      items: linhas,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** O retrato do cadastro de compositores, para o topo da tela. */
  async composersOverview() {
    const desde30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [
      total,
      verificados,
      comBio,
      comBioEn,
      comRetrato,
      comDatas,
      comunidade,
      novos30,
      porQualidade,
      comObras,
      maisObras,
      porEpoca,
      porNacionalidade,
      novosPorMes,
    ] = await Promise.all([
      this.prisma.composer.count(),
      this.prisma.composer.count({ where: { isVerified: true } }),
      this.prisma.composer.count({ where: texto('bio', true) }),
      this.prisma.composer.count({ where: texto('bioEn', true) }),
      // `portraitUrl` vem preenchido até sem foto: o IMSLP devolve a imagem
      // "Nocomposerphotoavailable". Quem sabe se o retrato é real é
      // `hasValidImage`.
      this.prisma.composer.count({ where: { hasValidImage: true } }),
      this.prisma.composer.count({
        where: { AND: [texto('birthDate', true), texto('deathDate', true)] },
      }),
      this.prisma.composer.count({ where: { isCustom: true } }),
      this.prisma.composer.count({ where: { createdAt: { gte: desde30 } } }),
      this.prisma.composer.groupBy({
        by: ['dataQuality'],
        _count: { _all: true },
      }),
      this.prisma.work.groupBy({ by: ['composerId'] }),
      topPorContagem(this.prisma, 'Work', 'composerId', { limite: 5 }),
      topPorContagem(this.prisma, 'Composer', 'epochId', { limite: 30 }),
      topPorContagem(this.prisma, 'Composer', 'nationality', { limite: 12 }),
      porMes(this.prisma, 'Composer'),
    ]);

    const nomes = await this.prisma.composer.findMany({
      where: { id: { in: maisObras.map((r) => r.id) } },
      select: { id: true, name: true },
    });
    const nome = new Map(nomes.map((n) => [n.id, n.name]));

    return {
      total,
      verificados,
      comBio,
      comBioEn,
      comRetrato,
      comDatas,
      comunidade,
      novos30,
      semObras: total - comObras.length,
      porQualidade: Object.fromEntries(
        porQualidade.map((r) => [r.dataQuality ?? 'none', r._count._all]),
      ),
      maisObras: maisObras.map((r) => ({
        id: r.id,
        name: nome.get(r.id) ?? '—',
        works: r.n,
      })),
      porEpoca: await this.comNomeDaEpoca(porEpoca),
      porNacionalidade: porNacionalidade.map((r) => ({
        nome: r.id,
        n: r.n,
      })),
      novosPorMes,
    };
  }

  async updateComposer(
    adminUserId: string,
    composerId: string,
    dto: UpdateComposerDto,
  ) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Nada para atualizar');
    }

    await this.requireComposer(composerId);

    const composer = await this.prisma.composer.update({
      where: { id: composerId },
      data: {
        ...(dto.dataQuality ? { dataQuality: dto.dataQuality } : {}),
        ...(dto.isVerified !== undefined
          ? verificationChange(
              dto.isVerified,
              adminUserId,
              dto.verificationNotes,
            )
          : dto.verificationNotes !== undefined
            ? { verificationNotes: dto.verificationNotes }
            : {}),
      },
      select: COMPOSER_SELECT,
    });

    await this.invalidateComposerCache();

    return composer;
  }

  /**
   * Verifica ou desverifica compositores em lote.
   *
   * **A "auditoria" do legado era um `console.log`.** A rota montava um objeto
   * chamado `auditLog`, com ação, autor, lista de afetados e data — e o
   * imprimia na saída padrão. Uma operação que muda o selo de verificação de
   * uma lista arbitrária de compositores não deixava registro nenhum
   * consultável. Aqui a rota é `@Audited()`, e o resultado diz exatamente
   * quantos e quais foram tocados.
   *
   * O `updateMany` é uma escrita só, e não um laço: são N linhas com os mesmos
   * valores. Mas os compositores são lidos **antes**, porque o retorno precisa
   * dizer *quais* mudaram — pedir 50 ids e receber "40 atualizados" sem saber
   * quais dez não existiam é um relatório inútil.
   */
  async verifyComposersInBulk(
    adminUserId: string,
    composerIds: string[],
    isVerified: boolean,
    notes?: string,
  ) {
    const composers = await this.prisma.composer.findMany({
      where: { id: { in: composerIds } },
      select: { id: true, name: true, fullName: true },
    });

    if (composers.length === 0) {
      throw new NotFoundException(
        'Nenhum dos compositores informados foi encontrado',
      );
    }

    const found = composers.map((composer) => composer.id);

    const result = await this.prisma.composer.updateMany({
      where: { id: { in: found } },
      data: verificationChange(isVerified, adminUserId, notes),
    });

    await this.invalidateComposerCache();

    return {
      isVerified,
      updated: result.count,
      composers: composers.map((composer) => ({
        id: composer.id,
        name: composer.fullName ?? composer.name,
      })),
      // Ids pedidos que não existem. O legado só devolvia a contagem.
      notFound: composerIds.filter((id) => !found.includes(id)),
    };
  }

  /**
   * Remove um compositor sem obras.
   *
   * A checagem e a remoção vão na **mesma transação**. No legado eram duas
   * chamadas soltas: entre contar as obras e apagar o compositor, uma
   * importação de catálogo podia inserir obras, e o `onDelete: Cascade` da
   * relação as levava junto.
   */
  async deleteComposer(composerId: string): Promise<void> {
    await this.requireComposer(composerId);

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const works = await tx.work.count({ where: { composerId } });

      if (works > 0) {
        throw new ConflictException(
          `Este compositor tem ${works} obra(s) associada(s). Remova ou realoque as obras primeiro.`,
        );
      }

      await tx.composer.delete({ where: { id: composerId } });
    });
  }

  // -------------------------------------------------------------------
  // Obras
  // -------------------------------------------------------------------

  /** O retrato do catálogo de obras, para o topo da tela. */
  async worksOverview() {
    const desde30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [
      total,
      verificadas,
      comunidade,
      novas30,
      comVideo,
      comPartitura,
      porTipo,
      favoritas,
      queridas,
      aprendidas,
      porEpoca,
      novasPorMes,
    ] = await Promise.all([
      this.prisma.work.count(),
      this.prisma.work.count({ where: { isVerified: true } }),
      this.prisma.work.count({ where: { isCustom: true } }),
      this.prisma.work.count({ where: { createdAt: { gte: desde30 } } }),
      this.prisma.work.count({
        where: {
          OR: [{ videoUrl: { not: null } }, { youtubeVideoUrl: { not: null } }],
        },
      }),
      this.prisma.workScore.groupBy({ by: ['workId'] }),
      this.prisma.work.groupBy({ by: ['workType'], _count: { _all: true } }),
      topPorContagem(this.prisma, 'FavoriteWork', 'workId', { limite: 5 }),
      topPorContagem(this.prisma, 'WantToLearn', 'workId', { limite: 5 }),
      topPorContagem(this.prisma, 'Learned', 'workId', { limite: 5 }),
      topPorContagem(this.prisma, 'Work', 'epochId', { limite: 30 }),
      porMes(this.prisma, 'Work'),
    ]);

    const ids = [...favoritas, ...queridas, ...aprendidas].map((r) => r.id);
    const obras = await this.prisma.work.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, title: true, composer: { select: { name: true } } },
    });
    const obra = new Map(obras.map((o) => [o.id, o]));
    const ranking = (rows: typeof favoritas) =>
      rows.map((r) => ({
        id: r.id,
        title: obra.get(r.id)?.title ?? '—',
        composer: obra.get(r.id)?.composer?.name ?? null,
        n: r.n,
      }));

    return {
      total,
      verificadas,
      comunidade,
      novas30,
      comVideo,
      comPartitura: comPartitura.length,
      semPartitura: total - comPartitura.length,
      porTipo: Object.fromEntries(
        porTipo.map((r) => [r.workType, r._count._all]),
      ),
      maisFavoritadas: ranking(favoritas),
      maisQueridas: ranking(queridas),
      maisAprendidas: ranking(aprendidas),
      porEpoca: await this.comNomeDaEpoca(porEpoca),
      novasPorMes,
    };
  }

  /** As contagens por época, com o nome de cada uma. */
  private async comNomeDaEpoca(linhas: Array<{ id: string; n: number }>) {
    const epocas = await this.prisma.epoch.findMany({
      where: { id: { in: linhas.map((l) => l.id) } },
      select: { id: true, name: true },
    });
    const nome = new Map(epocas.map((e) => [e.id, e.name]));
    return linhas.map((l) => ({
      id: l.id,
      nome: nome.get(l.id) ?? 'Sem época',
      n: l.n,
    }));
  }

  /** O detalhe da obra além do cadastro: uso, partituras, anotações, origem. */
  async workSummary(workId: string) {
    const work = await this.prisma.work.findUnique({
      where: { id: workId },
      select: {
        id: true,
        imslpPermlink: true,
        youtubeVideoUrl: true,
        instrumentation: true,
        compositionYear: true,
        createdByUser: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        _count: {
          select: {
            favoriteBy: true,
            learners: true,
            wantToLearners: true,
            cachedScores: true,
            workAnnotations: true,
          },
        },
        cachedScores: {
          take: 8,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            title: true,
            type: true,
            isActive: true,
            downloadUrl: true,
          },
        },
      },
    });
    if (!work) throw new NotFoundException('Obra não encontrada');

    const { createdByUser, _count, cachedScores, ...resto } = work;
    return {
      ...resto,
      createdBy: createdByUser
        ? {
            id: createdByUser.id,
            name:
              [createdByUser.firstName, createdByUser.lastName]
                .filter(Boolean)
                .join(' ') || createdByUser.email,
          }
        : null,
      counts: {
        favorites: _count.favoriteBy,
        learned: _count.learners,
        wantToLearn: _count.wantToLearners,
        scores: _count.cachedScores,
        annotations: _count.workAnnotations,
      },
      scores: cachedScores,
    };
  }

  async listWorks(query: ListWorksQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const search = query.search?.trim();

    const { workIds, excludeIds, capped } =
      await this.countFilters.resolve(query);

    // Nenhuma obra satisfaz os critérios de contagem: responder já, sem
    // montar um `IN` vazio.
    if (workIds !== null && workIds.length === 0) {
      return {
        works: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
        coverage: { countFilterCapped: capped },
      };
    }

    const and: Prisma.WorkWhereInput[] = [];
    if (query.hasScore !== undefined) {
      and.push({
        cachedScores: query.hasScore ? { some: {} } : { none: {} },
      });
    }
    if (query.hasVideo !== undefined) {
      and.push(
        query.hasVideo
          ? {
              OR: [
                { videoUrl: { not: null } },
                { youtubeVideoUrl: { not: null } },
              ],
            }
          : {
              AND: [
                { OR: [{ videoUrl: null }, { videoUrl: { isSet: false } }] },
                {
                  OR: [
                    { youtubeVideoUrl: null },
                    { youtubeVideoUrl: { isSet: false } },
                  ],
                },
              ],
            },
      );
    }
    if (query.createdFrom || query.createdTo) {
      and.push({
        createdAt: {
          ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
          ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
        },
      });
    }
    if (excludeIds.length) and.push({ id: { notIn: excludeIds } });

    const where: Prisma.WorkWhereInput = {
      ...(workIds !== null ? { id: { in: workIds } } : {}),
      ...(query.isCustom !== undefined ? { isCustom: query.isCustom } : {}),
      ...(and.length ? { AND: and } : {}),
      ...(query.composerId ? { composerId: query.composerId } : {}),
      ...(query.epochId ? { epochId: query.epochId } : {}),
      ...(query.instrumentId ? { instrumentId: query.instrumentId } : {}),
      ...(query.workType ? { workType: query.workType } : {}),
      ...(query.difficultyLevel
        ? { difficultyLevel: query.difficultyLevel }
        : {}),
      ...(query.isVerified !== undefined
        ? { isVerified: query.isVerified }
        : {}),
      ...(search
        ? { title: { contains: escapeRegex(search), mode: 'insensitive' } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.work.findMany({
        where,
        select: WORK_SELECT,
        orderBy: [
          { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
          { id: 'asc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.work.count({ where }),
    ]);

    const works = rows.map(({ _count, ...w }) => ({
      ...w,
      counts: {
        favorites: _count.favoriteBy,
        learned: _count.learners,
        wantToLearn: _count.wantToLearners,
        scores: _count.cachedScores,
      },
    }));

    return {
      works,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      // Avisa quando o filtro de contagem bateu no teto de candidatos: a
      // listagem passa a ser "as melhores colocadas", não "todas".
      coverage: { countFilterCapped: capped },
    };
  }

  /**
   * Edita uma obra.
   *
   * **A rota do legado quebrava ao verificar.** Ela montava
   * `updateData.dataQuality` e `updateData.verificationNotes`, e nenhum dos
   * dois campos existe em `Work` — conferi no schema do próprio front, não só
   * no desta API. Como o ramo de verificação sempre gravava
   * `verificationNotes`, **toda** tentativa de marcar uma obra como verificada
   * caía em erro de validação do Prisma e respondia 500. Os dois campos só
   * existem em `Composer`.
   */
  async updateWork(adminUserId: string, workId: string, dto: UpdateWorkDto) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Nada para atualizar');
    }

    await this.requireWork(workId);

    const work = await this.prisma.work.update({
      where: { id: workId },
      data: {
        title: dto.title,
        difficultyLevel: dto.difficultyLevel,
        workType: dto.workType,
        videoUrl: dto.videoUrl,
        instrumentation: dto.instrumentation,
        lastEditedBy: adminUserId,
        lastEditedAt: new Date(),
        // `Work` tem `isVerified`, `verificationStatus`, `verifiedBy` e
        // `verifiedAt`, mas **não** tem `verificationNotes` nem `dataQuality` —
        // ver a nota em `updateWork`. Daí o núcleo sem a nota.
        ...(dto.isVerified !== undefined
          ? verificationCore(dto.isVerified, adminUserId)
          : {}),
      },
      select: WORK_SELECT,
    });

    await this.invalidateComposerCache();

    return work;
  }

  /**
   * Remove uma obra sem dados de usuário associados.
   *
   * **Anotação privada também conta.** O legado só somava
   * `workAnnotation.count({ isPublic: true })`, mas a relação apaga em cascata
   * todas as anotações da obra — então uma obra com cinquenta anotações
   * privadas passava na verificação e as levava junto. Anotação privada é
   * justamente a que o autor não tem como recuperar de outro lugar.
   *
   * As partituras também entram na conta, e a verificação roda na mesma
   * transação da remoção.
   */
  async deleteWork(workId: string): Promise<void> {
    await this.requireWork(workId);

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const [favorites, wantToLearn, learned, annotations, scores] =
        await Promise.all([
          tx.favoriteWork.count({ where: { workId } }),
          tx.wantToLearn.count({ where: { workId } }),
          tx.learned.count({ where: { workId } }),
          tx.workAnnotation.count({ where: { workId } }),
          tx.workScore.count({ where: { workId } }),
        ]);

      const blockers = [
        favorites > 0 ? `${favorites} favorito(s)` : null,
        wantToLearn > 0 ? `${wantToLearn} em "quero aprender"` : null,
        learned > 0 ? `${learned} em "já aprendi"` : null,
        annotations > 0 ? `${annotations} anotação(ões)` : null,
        scores > 0 ? `${scores} partitura(s)` : null,
      ].filter((item): item is string => item !== null);

      if (blockers.length > 0) {
        throw new ConflictException(
          `Esta obra tem dados associados que seriam apagados junto: ${blockers.join(', ')}.`,
        );
      }

      await tx.work.delete({ where: { id: workId } });
    });
  }

  // -------------------------------------------------------------------
  // Partituras
  // -------------------------------------------------------------------

  /**
   * Verifica ou desverifica obras em lote — o mesmo contrato do lote de
   * compositores: uma escrita só, a resposta diz quais foram tocadas e quais
   * ids não existiam. Com 8 de 207 mil obras verificadas, fazer uma a uma
   * pelo painel é o que impede a curadoria de andar.
   */
  async verifyWorksInBulk(
    adminUserId: string,
    workIds: string[],
    isVerified: boolean,
  ) {
    const works = await this.prisma.work.findMany({
      where: { id: { in: workIds } },
      select: { id: true, title: true },
    });

    if (works.length === 0) {
      throw new NotFoundException(
        'Nenhuma das obras informadas foi encontrada',
      );
    }

    const found = works.map((work) => work.id);

    const result = await this.prisma.work.updateMany({
      where: { id: { in: found } },
      data: verificationCore(isVerified, adminUserId),
    });

    await this.invalidateComposerCache();

    return {
      isVerified,
      updated: result.count,
      works: works.map((work) => ({ id: work.id, title: work.title })),
      notFound: workIds.filter((id) => !found.includes(id)),
    };
  }

  async listScores(query: ListScoresQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const search = query.search?.trim();

    const where: Prisma.WorkScoreWhereInput = {
      ...(query.workId ? { workId: query.workId } : {}),
      ...(query.composerId ? { work: { composerId: query.composerId } } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.hasFile !== undefined
        ? query.hasFile
          ? {
              AND: [
                { downloadUrl: { not: null } },
                { downloadUrl: { not: '' } },
              ],
            }
          : {
              OR: [
                { downloadUrl: null },
                { downloadUrl: { isSet: false } },
                { downloadUrl: '' },
              ],
            }
        : {}),
      ...(query.createdFrom || query.createdTo
        ? {
            createdAt: {
              ...(query.createdFrom
                ? { gte: new Date(query.createdFrom) }
                : {}),
              ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
            },
          }
        : {}),
      ...(search
        ? { title: { contains: escapeRegex(search), mode: 'insensitive' } }
        : {}),
    };

    const [scores, total] = await Promise.all([
      this.prisma.workScore.findMany({
        where,
        select: SCORE_SELECT,
        orderBy: [{ createdAt: query.sortOrder ?? 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.workScore.count({ where }),
    ]);

    return {
      scores,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** O retrato das partituras, para o topo da tela. */
  async scoresOverview() {
    const desde30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [
      total,
      ativas,
      novas30,
      porTipo,
      porOrigem,
      obras,
      favoritas,
      topo,
      novasPorMes,
    ] = await Promise.all([
      this.prisma.workScore.count(),
      this.prisma.workScore.count({ where: { isActive: true } }),
      this.prisma.workScore.count({ where: { createdAt: { gte: desde30 } } }),
      this.prisma.workScore.groupBy({ by: ['type'], _count: { _all: true } }),
      this.prisma.workScore.groupBy({
        by: ['source'],
        _count: { _all: true },
      }),
      this.prisma.workScore.groupBy({ by: ['workId'] }),
      this.prisma.favoriteScore.count(),
      // O favorito guarda o `sourceId` da partitura, não o id do registro.
      topPorContagem(this.prisma, 'favorite_scores', 'scoreId', {
        limite: 10,
      }),
      porMes(this.prisma, 'work_scores'),
    ]);
    const registros = topo.length
      ? await this.prisma.workScore.findMany({
          where: { sourceId: { in: topo.map((t) => t.id) } },
          select: {
            id: true,
            title: true,
            sourceId: true,
            work: {
              select: {
                id: true,
                title: true,
                composer: { select: { name: true } },
              },
            },
          },
        })
      : [];
    const porSource = new Map(registros.map((r) => [r.sourceId, r]));
    const maisFavoritadas = topo.flatMap((t) => {
      const r = porSource.get(t.id);
      return r
        ? [
            {
              id: r.id,
              titulo: r.title,
              obra: r.work?.title ?? null,
              compositor: r.work?.composer?.name ?? null,
              favoritos: t.n,
            },
          ]
        : [];
    });
    return {
      total,
      ativas,
      inativas: total - ativas,
      novas30,
      obrasComPartitura: obras.length,
      favoritadas: favoritas,
      maisFavoritadas,
      novasPorMes,
      porTipo: Object.fromEntries(porTipo.map((r) => [r.type, r._count._all])),
      porOrigem: Object.fromEntries(
        porOrigem.map((r) => [r.source, r._count._all]),
      ),
    };
  }

  async updateScore(scoreId: string, dto: UpdateScoreDto) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Nada para atualizar');
    }

    const score = await this.prisma.workScore.findUnique({
      where: { id: scoreId },
      select: { id: true },
    });

    if (!score) {
      throw new NotFoundException('Partitura não encontrada');
    }

    return this.prisma.workScore.update({
      where: { id: scoreId },
      data: { title: dto.title, isActive: dto.isActive },
      select: SCORE_SELECT,
    });
  }

  // -------------------------------------------------------------------

  private async requireComposer(composerId: string) {
    const composer = await this.prisma.composer.findUnique({
      where: { id: composerId },
      select: { id: true },
    });

    if (!composer) {
      throw new NotFoundException('Compositor não encontrado');
    }

    return composer;
  }

  private async requireWork(workId: string) {
    const work = await this.prisma.work.findUnique({
      where: { id: workId },
      select: { id: true },
    });

    if (!work) {
      throw new NotFoundException('Obra não encontrada');
    }

    return work;
  }
}

/**
 * Campo de texto preenchido ou vazio. No Mongo "vazio" é três coisas: o campo
 * ausente, nulo, ou texto em branco — e o legado gravou as três.
 */
function texto(
  campo: 'bio' | 'bioEn' | 'birthDate' | 'deathDate',
  preenchido: boolean,
): Prisma.ComposerWhereInput {
  return preenchido
    ? {
        AND: [
          { [campo]: { isSet: true } },
          { [campo]: { not: null } },
          { [campo]: { not: '' } },
        ],
      }
    : {
        OR: [{ [campo]: { isSet: false } }, { [campo]: null }, { [campo]: '' }],
      };
}
