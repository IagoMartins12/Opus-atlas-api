import { escapeRegex } from '../../common/utils/regex.util';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppCacheService } from '../../common/cache/cache.service';
import { CATALOG_NAMESPACES } from '../../common/cache/cache-keys';
import { StorageService } from '../../common/storage/storage.service';
import {
  RequestContext,
  UploadHistoryService,
} from '../shared/upload-history.service';
import {
  cleanNameForComparison,
  extractImslpId,
  generateNameVariations,
  isSimilarName,
} from '../shared/name-matching.util';
import { CheckComposerDuplicateDto } from './dto/check-composer-duplicate.dto';
import { ComposerDuplicateResponseDto } from './dto/composer-duplicate-response.dto';
import { CreateComposerContributionDto } from './dto/create-composer-contribution.dto';
import { UpdateComposerContributionDto } from './dto/update-composer-contribution.dto';
import { ActivityTracker } from '../../common/events/activity-tracker.service';

/** Campos que entram no cálculo de completude do cadastro. */
const COMPLETENESS_FIELDS = [
  'name',
  'fullName',
  'birthDate',
  'deathDate',
  'portraitUrl',
  'bio',
  'nationality',
  'instruments',
  'permLinkImslp',
  'videoUrl',
] as const;

const DUPLICATE_SELECT = {
  id: true,
  name: true,
  fullName: true,
  alternativeNames: true,
  portraitUrl: true,
  nationality: true,
  birthDate: true,
  deathDate: true,
  epochName: true,
  imslpId: true,
  permLinkImslp: true,
  wikipediaLink: true,
} as const;

@Injectable()
export class ComposerUploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly history: UploadHistoryService,
    private readonly storage: StorageService,
    private readonly cache: AppCacheService,
    private readonly activity: ActivityTracker,
  ) {}

  // -------------------------------------------------------------------
  // Criação
  // -------------------------------------------------------------------

  async create(
    userId: string,
    dto: CreateComposerContributionDto,
    context: RequestContext,
  ) {
    await this.assertReferencesExist(dto.epochId, dto.primaryRoleId);

    const composer = await this.prisma.composer.create({
      data: {
        name: dto.name,
        fullName: dto.fullName,
        alternativeNames: dto.alternativeNames ?? null,
        birthDate: dto.birthDate ?? null,
        deathDate: dto.deathDate ?? null,
        portraitUrl: dto.portraitUrl ?? null,
        epochId: dto.epochId,
        epochName: dto.epochName ?? null,
        bio: dto.bio ?? null,
        bioEn: dto.bioEn ?? null,
        imslpId: dto.imslpId ?? null,
        permLinkImslp: dto.permLinkImslp ?? null,
        wikipediaLink: dto.wikipediaLink ?? null,
        videoUrl: dto.videoUrl ?? null,
        nationality: dto.nationality ?? null,
        instruments: dto.instruments ?? null,
        imslpCategories: dto.imslpCategories ?? null,
        primaryRoleId: dto.primaryRoleId,
        roles: dto.roles ?? null,
        dataSource: dto.dataSource ?? 'none',
        // Campos de curadoria são definidos pelo servidor, nunca pelo cliente.
        createdBy: userId,
        isCustom: true,
        hasValidImage: Boolean(dto.portraitUrl),
        lastVerified: new Date(),
        dataCompleteness: this.calculateCompleteness(dto),
      },
      include: {
        epoch: { select: { name: true } },
        primaryRole: { select: { name: true } },
      },
    });

    await this.history.record({
      userId,
      entityType: 'composer',
      entityId: composer.id,
      action: 'create',
      changes: {
        name: composer.name,
        fullName: composer.fullName,
        epochName: composer.epoch.name,
        primaryRole: composer.primaryRole.name,
        nationality: composer.nationality,
        birthDate: composer.birthDate,
        deathDate: composer.deathDate,
        videoUrl: composer.videoUrl,
        permLinkImslp: composer.permLinkImslp,
      },
      context,
    });

    this.activity.track(
      userId,
      'contributions',
      'contribution.composer.created',
    );

    await this.invalidateCatalogCache();

    return composer;
  }

  // -------------------------------------------------------------------
  // Edição e exclusão
  // -------------------------------------------------------------------

  async update(
    userId: string,
    isAdmin: boolean,
    composerId: string,
    dto: UpdateComposerContributionDto,
    context: RequestContext,
  ) {
    const existing = await this.findOwnedComposer(composerId, userId, isAdmin);

    if (dto.epochId || dto.primaryRoleId) {
      await this.assertReferencesExist(dto.epochId, dto.primaryRoleId);
    }

    const data: Prisma.ComposerUpdateInput = {};
    const changed: Record<string, unknown> = {};

    // Só os campos realmente enviados são gravados: enviar `undefined` para o
    // Prisma é diferente de enviar `null`, e sobrescrever o que o usuário não
    // tocou apagaria dado existente.
    const assign = <K extends keyof UpdateComposerContributionDto>(key: K) => {
      const value = dto[key];
      if (value !== undefined) {
        (data as Record<string, unknown>)[key as string] = value;
        changed[key as string] = value;
      }
    };

    (
      [
        'name',
        'fullName',
        'alternativeNames',
        'birthDate',
        'deathDate',
        'portraitUrl',
        'epochName',
        'bio',
        'bioEn',
        'imslpId',
        'permLinkImslp',
        'wikipediaLink',
        'videoUrl',
        'nationality',
        'instruments',
        'imslpCategories',
        'roles',
        'dataSource',
      ] as const
    ).forEach(assign);

    if (dto.epochId) {
      data.epoch = { connect: { id: dto.epochId } };
      changed.epochId = dto.epochId;
    }

    if (dto.primaryRoleId) {
      data.primaryRole = { connect: { id: dto.primaryRoleId } };
      changed.primaryRoleId = dto.primaryRoleId;
    }

    if (dto.portraitUrl !== undefined) {
      data.hasValidImage = Boolean(dto.portraitUrl);
    }

    // Biografia editada por gente deixa de ser "gerada por IA", mesmo que a
    // edição tenha partido do texto da IA: alguém leu e assumiu.
    if (dto.bio !== undefined) {
      data.bioGeneratedBy = null;
      data.bioGeneratedAt = null;
    }

    data.dataCompleteness = this.calculateCompleteness({
      ...existing,
      ...dto,
    });
    data.lastVerified = new Date();

    const composer = await this.prisma.composer.update({
      where: { id: composerId },
      data,
      include: {
        epoch: { select: { name: true } },
        primaryRole: { select: { name: true } },
      },
    });

    await this.history.record({
      userId,
      entityType: 'composer',
      entityId: composerId,
      action: 'update',
      changes: changed as Prisma.InputJsonValue,
      context,
    });

    await this.invalidateCatalogCache();

    return composer;
  }

  async remove(
    userId: string,
    isAdmin: boolean,
    composerId: string,
    context: RequestContext,
  ): Promise<void> {
    const composer = await this.findOwnedComposer(composerId, userId, isAdmin);

    // Os arquivos saem antes do registro: se a ordem fosse invertida e a
    // remoção falhasse no meio, o retrato ficaria no armazenamento sem nenhuma
    // linha apontando para ele — órfão permanente.
    await this.storage.deleteByEntity('composer', composerId);

    await this.prisma.composer.delete({ where: { id: composerId } });

    await this.history.record({
      userId,
      entityType: 'composer',
      entityId: composerId,
      action: 'delete',
      changes: { name: composer.name, fullName: composer.fullName },
      context,
    });

    await this.invalidateCatalogCache();
  }

  /**
   * O que será apagado junto com o compositor.
   *
   * A exclusão em cascata do schema derruba obras, partituras e anotações
   * associadas. Mostrar isso antes evita que alguém apague um compositor do
   * catálogo sem perceber que está levando centenas de obras junto.
   */
  async cascadeInfo(composerId: string) {
    const composer = await this.prisma.composer.findUnique({
      where: { id: composerId },
      select: { id: true, name: true, fullName: true, createdBy: true },
    });

    if (!composer) {
      throw new NotFoundException('Compositor não encontrado');
    }

    const works = await this.prisma.work.findMany({
      where: { composerId },
      select: { id: true, title: true },
      orderBy: { title: 'asc' },
    });

    const ids = works.map((work) => work.id);

    const [scoresByWork, annotations, favorites, storedAssets] =
      await Promise.all([
        ids.length
          ? this.prisma.workScore.groupBy({
              by: ['workId'],
              where: { workId: { in: ids } },
              _count: { _all: true },
            })
          : Promise.resolve([]),
        ids.length
          ? this.prisma.workAnnotation.count({ where: { workId: { in: ids } } })
          : Promise.resolve(0),
        this.prisma.favoriteComposer.count({ where: { composerId } }),
        this.storage.findActiveByEntity('composer', composerId),
      ]);

    const scoresCount = new Map(
      scoresByWork.map((row) => [row.workId, row._count._all]),
    );
    const scores = [...scoresCount.values()].reduce(
      (sum, count) => sum + count,
      0,
    );

    return {
      composer: {
        id: composer.id,
        name: composer.name,
        fullName: composer.fullName,
      },
      // A tela de confirmação lista as obras que vão junto — o nome diz mais
      // que o número.
      works: works.map((work) => ({
        id: work.id,
        title: work.title,
        scoresCount: scoresCount.get(work.id) ?? 0,
      })),
      willDelete: {
        works: ids.length,
        scores,
        annotations,
        favorites,
        files: storedAssets.length,
      },
    };
  }

  // -------------------------------------------------------------------
  // Detecção de duplicata
  // -------------------------------------------------------------------

  /**
   * Procura um compositor equivalente antes do cadastro.
   *
   * Duas frentes: o link de origem (IMSLP ou Wikipedia) e a grafia do nome.
   * A busca por nome usa igualdade contra grafias alternativas pré-geradas, o
   * que é indexável — a comparação difusa fica só na classificação do motivo,
   * depois que o candidato já foi encontrado.
   */
  async checkDuplicate(
    dto: CheckComposerDuplicateDto,
  ): Promise<ComposerDuplicateResponseDto> {
    const conditions: Prisma.ComposerWhereInput[] = [];
    const url = dto.url.trim();

    if (dto.source === 'imslp') {
      conditions.push({ imslpId: url }, { permLinkImslp: url });

      const imslpId = extractImslpId(url);
      if (imslpId) {
        conditions.push(
          { imslpId },
          {
            permLinkImslp: {
              contains: escapeRegex(imslpId),
              mode: 'insensitive',
            },
          },
        );
      }
    } else {
      conditions.push({ wikipediaLink: url });
    }

    if (dto.fullName?.trim()) {
      const raw = dto.fullName.trim();
      const cleaned = cleanNameForComparison(raw);

      const names = new Set<string>([
        raw,
        cleaned,
        ...generateNameVariations(cleaned),
      ]);

      for (const name of names) {
        conditions.push({
          fullName: { equals: escapeRegex(name), mode: 'insensitive' },
        });
      }
    }

    if (conditions.length === 0) {
      return { found: false, composer: null };
    }

    const where: Prisma.ComposerWhereInput = dto.excludeId
      ? { AND: [{ OR: conditions }, { id: { not: dto.excludeId } }] }
      : { OR: conditions };

    const existing = await this.prisma.composer.findFirst({
      where,
      select: DUPLICATE_SELECT,
    });

    if (!existing) {
      return { found: false, composer: null };
    }

    const { reason, matchDetails } = this.classifyMatch(dto, existing);
    const { alternativeNames: _unused, ...composer } = existing;

    return { found: true, composer, reason, matchDetails };
  }

  private classifyMatch(
    dto: CheckComposerDuplicateDto,
    existing: {
      fullName: string;
      alternativeNames: string | null;
      imslpId: string | null;
      permLinkImslp: string | null;
      wikipediaLink: string | null;
    },
  ): { reason: string; matchDetails: string } {
    const url = dto.url.trim();

    if (
      dto.source === 'imslp' &&
      (existing.imslpId === url || existing.permLinkImslp === url)
    ) {
      return {
        reason: 'link do IMSLP',
        matchDetails: existing.imslpId ?? existing.permLinkImslp ?? '',
      };
    }

    if (dto.source === 'wikipedia' && existing.wikipediaLink === url) {
      return {
        reason: 'link da Wikipedia',
        matchDetails: existing.wikipediaLink,
      };
    }

    if (
      dto.fullName &&
      (isSimilarName(existing.fullName, dto.fullName) ||
        isSimilarName(existing.alternativeNames, dto.fullName))
    ) {
      return { reason: 'nome', matchDetails: existing.fullName };
    }

    // Casou pela consulta mas não por nenhum critério legível — o link parcial
    // do IMSLP é o caso típico.
    return { reason: 'link do IMSLP', matchDetails: existing.imslpId ?? '' };
  }

  // -------------------------------------------------------------------
  // Apoio
  // -------------------------------------------------------------------

  private async assertReferencesExist(
    epochId?: string,
    primaryRoleId?: string,
  ): Promise<void> {
    const [epoch, role] = await Promise.all([
      epochId
        ? this.prisma.epoch.findUnique({
            where: { id: epochId },
            select: { id: true },
          })
        : Promise.resolve(null),
      primaryRoleId
        ? this.prisma.role.findUnique({
            where: { id: primaryRoleId },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    if (epochId && !epoch) {
      throw new BadRequestException('Época não encontrada');
    }

    if (primaryRoleId && !role) {
      throw new BadRequestException('Papel não encontrado');
    }
  }

  /**
   * Carrega o compositor garantindo que quem edita é o autor.
   *
   * Um moderador passa direto; um usuário comum só mexe no que enviou. Sem
   * essa checagem, qualquer autenticado poderia editar qualquer compositor do
   * catálogo — inclusive os 19 mil importados do IMSLP.
   */
  /**
   * O envio inteiro, para a tela de edição — do próprio autor, ou de admin.
   *
   * Faltava na API: as páginas `upload/<tipo>/[id]/edit` do front carregam o compositor
   * por aqui antes de mostrar o formulário.
   */
  async findForEdit(id: string, userId: string, isAdmin: boolean) {
    await this.findOwnedComposer(id, userId, isAdmin);

    return this.prisma.composer.findUnique({
      where: { id },
      include: {
        epoch: { select: { id: true, name: true } },
        primaryRole: { select: { id: true, name: true } },
      },
    });
  }

  private async findOwnedComposer(
    composerId: string,
    userId: string,
    isAdmin: boolean,
  ) {
    const composer = await this.prisma.composer.findUnique({
      where: { id: composerId },
      select: {
        id: true,
        name: true,
        fullName: true,
        birthDate: true,
        deathDate: true,
        portraitUrl: true,
        bio: true,
        nationality: true,
        instruments: true,
        permLinkImslp: true,
        videoUrl: true,
        createdBy: true,
        isCustom: true,
      },
    });

    if (!composer) {
      throw new NotFoundException('Compositor não encontrado');
    }

    if (!isAdmin && composer.createdBy !== userId) {
      throw new ForbiddenException(
        'Você só pode alterar compositores que você mesmo cadastrou',
      );
    }

    return composer;
  }

  private calculateCompleteness(
    data: Partial<Record<(typeof COMPLETENESS_FIELDS)[number], unknown>>,
  ): number {
    const filled = COMPLETENESS_FIELDS.filter((field) => {
      const value = data[field];
      return typeof value === 'string' && value.trim().length > 0;
    }).length;

    return Math.round((filled / COMPLETENESS_FIELDS.length) * 100);
  }

  /**
   * Uma contribuição muda o que o catálogo público mostra, então o cache dele
   * precisa cair na hora — esperar o TTL faria o usuário não ver o próprio
   * envio e cadastrar de novo.
   */
  private async invalidateCatalogCache(): Promise<void> {
    await this.cache.invalidateMany(CATALOG_NAMESPACES);
  }
}
