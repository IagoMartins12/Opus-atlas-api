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
  createdAt: true,
  updatedAt: true,
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
  createdAt: true,
  composer: { select: { id: true, name: true } },
  epoch: { select: { id: true, name: true } },
  instrument: { select: { id: true, name: true } },
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
    const search = query.search?.trim();

    const where: Prisma.ComposerWhereInput = {
      ...(query.isVerified !== undefined
        ? { isVerified: query.isVerified }
        : {}),
      ...(query.dataQuality ? { dataQuality: query.dataQuality } : {}),
      ...(query.epochId ? { epochId: query.epochId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: escapeRegex(search), mode: 'insensitive' } },
              {
                fullName: {
                  contains: escapeRegex(search),
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };

    const [composers, total] = await Promise.all([
      this.prisma.composer.findMany({
        where,
        select: COMPOSER_SELECT,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.composer.count({ where }),
    ]);

    return {
      composers,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
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

  async listWorks(query: ListWorksQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const search = query.search?.trim();

    const { workIds, capped } = await this.countFilters.resolve(query);

    // Nenhuma obra satisfaz os critérios de contagem: responder já, sem
    // montar um `IN` vazio.
    if (workIds !== null && workIds.length === 0) {
      return {
        works: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
        coverage: { countFilterCapped: capped },
      };
    }

    const where: Prisma.WorkWhereInput = {
      ...(workIds !== null ? { id: { in: workIds } } : {}),
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

    const [works, total] = await Promise.all([
      this.prisma.work.findMany({
        where,
        select: WORK_SELECT,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.work.count({ where }),
    ]);

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

  async listScores(query: ListScoresQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const search = query.search?.trim();

    const where: Prisma.WorkScoreWhereInput = {
      ...(query.workId ? { workId: query.workId } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(search
        ? { title: { contains: escapeRegex(search), mode: 'insensitive' } }
        : {}),
    };

    const [scores, total] = await Promise.all([
      this.prisma.workScore.findMany({
        where,
        select: SCORE_SELECT,
        orderBy: { createdAt: query.sortOrder ?? 'desc' },
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
