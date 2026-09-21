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
import { extractImslpId } from '../shared/name-matching.util';
import { CheckWorkDuplicateDto } from './dto/check-work-duplicate.dto';
import { CreateWorkContributionDto } from './dto/create-work-contribution.dto';
import { UpdateWorkContributionDto } from './dto/update-work-contribution.dto';
import { WorkDuplicateResponseDto } from './dto/work-duplicate-response.dto';
import { ActivityTracker } from '../../common/events/activity-tracker.service';

/** Campos de mídia derivados do envio, montados por `buildMediaFields`. */
interface WorkMediaFields {
  spotifyTrackId: string | null;
  spotifyTrackUrl: string | null;
  youtubeVideoId: string | null;
  youtubeVideoUrl: string | null;
  youtubeTitle: string | null;
  customAudioUrl: string | null;
  videoAulaUrl: string | null;
  videoAulaTitle: string | null;
  videoAulaType: string | null;
  videoAulaSource: string | null;
  videoAulaAddedBy: string | null;
  videoAulaAddedAt: Date | null;
  mediaSource: string;
}

/** Campos simples copiados direto do DTO para o Prisma. */
const SCALAR_FIELDS = [
  'title',
  'subtitle',
  'opOrCatalog',
  'compositionYear',
  'firstPublishDate',
  'tone',
  'mediaDuration',
  'workStyle',
  'moviment',
  'dedicateTo',
  'instrumentation',
  'workType',
  'videoUrl',
  'spotifyTrackId',
  'spotifyTrackUrl',
  'youtubeVideoId',
  'youtubeVideoUrl',
  'youtubeTitle',
  'customAudioUrl',
  'videoAulaUrl',
  'videoAulaTitle',
  'videoAulaType',
  'videoAulaSource',
] as const;

@Injectable()
export class WorkUploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly history: UploadHistoryService,
    private readonly storage: StorageService,
    private readonly cache: AppCacheService,
    private readonly activity: ActivityTracker,
  ) {}

  async create(
    userId: string,
    dto: CreateWorkContributionDto,
    context: RequestContext,
  ) {
    const { composer, instrument, epoch } = await this.assertReferencesExist(
      dto.composerId,
      dto.instrumentId,
      dto.epochId,
    );

    const media = this.buildMediaFields(dto, userId);

    const work = await this.prisma.work.create({
      data: {
        title: dto.title,
        composerId: dto.composerId,
        instrumentId: dto.instrumentId,
        epochId: dto.epochId,
        subtitle: dto.subtitle ?? null,
        opOrCatalog: dto.opOrCatalog ?? null,
        compositionYear: dto.compositionYear ?? null,
        firstPublishDate: dto.firstPublishDate ?? null,
        tone: dto.tone ?? null,
        mediaDuration: dto.mediaDuration ?? null,
        workStyle: dto.workStyle ?? null,
        moviment: dto.moviment ?? null,
        dedicateTo: dto.dedicateTo ?? null,
        instrumentation: dto.instrumentation ?? null,
        videoUrl: dto.videoUrl ?? null,
        workType: dto.workType ?? 'INDIVIDUAL',
        movementNumber: dto.movementNumber ?? null,
        // String vazia vinda de formulário não é "sem obra-mãe" para o Prisma:
        // ela viraria um ObjectId inválido e quebraria a escrita.
        parentWorkId: dto.parentWorkId || null,
        categoryNames: dto.categoryNames ?? [],
        workGenresArr: dto.workGenresArr ?? [],
        imslpTags: dto.imslpTags ?? [],
        // Os dois campos são obrigatórios no schema; obra enviada à mão não tem
        // origem no IMSLP, então entram vazios em vez de nulos.
        imslpPermlink: dto.imslpPermlink ?? '',
        imslpId: dto.imslpId ?? '',
        ...media,
        createdBy: userId,
        isCustom: true,
      },
      include: {
        composer: { select: { name: true, fullName: true } },
        epoch: { select: { name: true } },
        instrument: { select: { name: true } },
      },
    });

    await this.history.record({
      userId,
      entityType: 'work',
      entityId: work.id,
      action: 'create',
      changes: {
        title: work.title,
        subtitle: work.subtitle,
        composerName: composer.fullName ?? composer.name,
        epochName: epoch.name,
        instrumentName: instrument.name,
        opOrCatalog: work.opOrCatalog,
        workType: work.workType,
        dataSource: dto.dataSource ?? 'manual',
        hasSpotify: Boolean(work.spotifyTrackId),
        hasYoutube: Boolean(work.youtubeVideoId),
        hasCustomAudio: Boolean(work.customAudioUrl),
        hasVideoAula: Boolean(work.videoAulaUrl),
        mediaSource: work.mediaSource,
      },
      context,
    });

    this.activity.track(userId, 'contributions', 'contribution.work.created');

    await this.invalidateCatalogCache();

    return work;
  }

  async update(
    userId: string,
    isAdmin: boolean,
    workId: string,
    dto: UpdateWorkContributionDto,
    context: RequestContext,
  ) {
    await this.findOwnedWork(workId, userId, isAdmin);

    if (dto.composerId || dto.instrumentId || dto.epochId) {
      await this.assertReferencesExist(
        dto.composerId,
        dto.instrumentId,
        dto.epochId,
      );
    }

    const data: Prisma.WorkUncheckedUpdateInput = {};
    const changed: Record<string, unknown> = {};

    for (const field of SCALAR_FIELDS) {
      const value = dto[field];
      if (value !== undefined) {
        (data as Record<string, unknown>)[field] = value;
        changed[field] = value;
      }
    }

    if (dto.composerId) {
      data.composerId = dto.composerId;
      changed.composerId = dto.composerId;
    }
    if (dto.instrumentId) {
      data.instrumentId = dto.instrumentId;
      changed.instrumentId = dto.instrumentId;
    }
    if (dto.epochId) {
      data.epochId = dto.epochId;
      changed.epochId = dto.epochId;
    }
    if (dto.parentWorkId !== undefined) {
      data.parentWorkId = dto.parentWorkId || null;
      changed.parentWorkId = data.parentWorkId;
    }
    if (dto.movementNumber !== undefined) {
      data.movementNumber = dto.movementNumber;
      changed.movementNumber = dto.movementNumber;
    }
    if (dto.categoryNames) {
      data.categoryNames = dto.categoryNames;
      changed.categoryNames = dto.categoryNames;
    }
    if (dto.workGenresArr) {
      data.workGenresArr = dto.workGenresArr;
      changed.workGenresArr = dto.workGenresArr;
    }
    if (dto.imslpTags) {
      data.imslpTags = dto.imslpTags;
      changed.imslpTags = dto.imslpTags;
    }

    const work = await this.prisma.work.update({
      where: { id: workId },
      data,
      include: {
        composer: { select: { name: true, fullName: true } },
        epoch: { select: { name: true } },
        instrument: { select: { name: true } },
      },
    });

    await this.history.record({
      userId,
      entityType: 'work',
      entityId: workId,
      action: 'update',
      changes: changed as Prisma.InputJsonValue,
      context,
    });

    await this.invalidateCatalogCache();

    return work;
  }

  async remove(
    userId: string,
    isAdmin: boolean,
    workId: string,
    context: RequestContext,
  ): Promise<void> {
    const work = await this.findOwnedWork(workId, userId, isAdmin);

    await this.storage.deleteByEntity('work', workId);
    await this.prisma.work.delete({ where: { id: workId } });

    await this.history.record({
      userId,
      entityType: 'work',
      entityId: workId,
      action: 'delete',
      changes: { title: work.title },
      context,
    });

    await this.invalidateCatalogCache();
  }

  async cascadeInfo(workId: string) {
    const work = await this.prisma.work.findUnique({
      where: { id: workId },
      select: { id: true, title: true, createdBy: true },
    });

    if (!work) {
      throw new NotFoundException('Obra não encontrada');
    }

    const [scoreList, annotations, favorites, wantToLearn, learned, files] =
      await Promise.all([
        // A tela de confirmação lista as partituras que vão junto.
        this.prisma.workScore.findMany({
          where: { workId },
          select: { id: true, title: true, source: true },
          orderBy: { title: 'asc' },
        }),
        this.prisma.workAnnotation.count({ where: { workId } }),
        this.prisma.favoriteWork.count({ where: { workId } }),
        this.prisma.wantToLearn.count({ where: { workId } }),
        this.prisma.learned.count({ where: { workId } }),
        this.storage.findActiveByEntity('work', workId),
      ]);

    return {
      work: { id: work.id, title: work.title },
      scores: scoreList,
      willDelete: {
        scores: scoreList.length,
        annotations,
        favorites,
        wantToLearn,
        learned,
        files: files.length,
      },
    };
  }

  /**
   * Procura uma obra equivalente.
   *
   * Duas frentes independentes: o link do IMSLP e o par título + compositor.
   * O par é o que pega a duplicata digitada à mão, já que a mesma obra do mesmo
   * compositor não deve ser cadastrada duas vezes.
   */
  async checkDuplicate(
    dto: CheckWorkDuplicateDto,
  ): Promise<WorkDuplicateResponseDto> {
    if (!dto.url && (!dto.title || !dto.composerId)) {
      throw new BadRequestException(
        'Informe a URL, ou o título junto com o compositor',
      );
    }

    const exclude: Prisma.WorkWhereInput = dto.excludeId
      ? { id: { not: dto.excludeId } }
      : {};

    const select = {
      id: true,
      title: true,
      subtitle: true,
      opOrCatalog: true,
      imslpPermlink: true,
      composer: { select: { name: true, fullName: true } },
    } as const;

    if (dto.url) {
      const url = dto.url.trim();
      const imslpId = extractImslpId(url) ?? url;

      const byUrl = await this.prisma.work.findFirst({
        where: {
          AND: [
            {
              OR: [
                { imslpPermlink: url },
                {
                  imslpPermlink: {
                    contains: escapeRegex(imslpId),
                    mode: 'insensitive',
                  },
                },
              ],
            },
            exclude,
          ],
        },
        select,
      });

      if (byUrl) {
        return { found: true, work: this.toDuplicateDto(byUrl), reason: 'url' };
      }
    }

    if (dto.title && dto.composerId) {
      const byTitle = await this.prisma.work.findFirst({
        where: {
          AND: [
            {
              title: {
                equals: escapeRegex(dto.title.trim()),
                mode: 'insensitive',
              },
            },
            { composerId: dto.composerId },
            exclude,
          ],
        },
        select,
      });

      if (byTitle) {
        return {
          found: true,
          work: this.toDuplicateDto(byTitle),
          reason: 'title_composer',
        };
      }
    }

    return { found: false, work: null };
  }

  // -------------------------------------------------------------------

  private toDuplicateDto(work: {
    id: string;
    title: string;
    subtitle: string | null;
    opOrCatalog: string | null;
    imslpPermlink: string;
    composer: { name: string; fullName: string | null };
  }) {
    return {
      id: work.id,
      title: work.title,
      subtitle: work.subtitle,
      opOrCatalog: work.opOrCatalog,
      imslpPermlink: work.imslpPermlink || null,
      composerName: work.composer.fullName ?? work.composer.name,
    };
  }

  /**
   * Monta os campos de mídia e deduz a origem.
   *
   * `mediaSource` fica como `none` quando nada foi informado, o que é o sinal
   * usado pela busca automática de mídia para saber que a obra ainda pode ser
   * enriquecida.
   */
  private buildMediaFields(
    dto: CreateWorkContributionDto,
    userId: string,
  ): WorkMediaFields {
    const hasMedia = Boolean(
      dto.spotifyTrackId ??
        dto.spotifyTrackUrl ??
        dto.youtubeVideoId ??
        dto.youtubeVideoUrl ??
        dto.customAudioUrl ??
        dto.videoAulaUrl,
    );

    return {
      spotifyTrackId: dto.spotifyTrackId ?? null,
      spotifyTrackUrl: dto.spotifyTrackUrl ?? null,
      youtubeVideoId: dto.youtubeVideoId ?? null,
      youtubeVideoUrl: dto.youtubeVideoUrl ?? null,
      youtubeTitle: dto.youtubeTitle ?? null,
      customAudioUrl: dto.customAudioUrl ?? null,
      videoAulaUrl: dto.videoAulaUrl ?? null,
      videoAulaTitle: dto.videoAulaTitle ?? null,
      videoAulaType: dto.videoAulaUrl ? (dto.videoAulaType ?? 'video') : null,
      videoAulaSource: dto.videoAulaUrl
        ? (dto.videoAulaSource ?? 'youtube')
        : null,
      videoAulaAddedBy: dto.videoAulaUrl ? userId : null,
      videoAulaAddedAt: dto.videoAulaUrl ? new Date() : null,
      mediaSource: hasMedia ? (dto.dataSource ?? 'manual') : 'none',
    };
  }

  private async assertReferencesExist(
    composerId?: string,
    instrumentId?: string,
    epochId?: string,
  ) {
    const [composer, instrument, epoch] = await Promise.all([
      composerId
        ? this.prisma.composer.findUnique({
            where: { id: composerId },
            select: { id: true, name: true, fullName: true },
          })
        : Promise.resolve(null),
      instrumentId
        ? this.prisma.instrument.findUnique({
            where: { id: instrumentId },
            select: { id: true, name: true },
          })
        : Promise.resolve(null),
      epochId
        ? this.prisma.epoch.findUnique({
            where: { id: epochId },
            select: { id: true, name: true },
          })
        : Promise.resolve(null),
    ]);

    if (composerId && !composer) {
      throw new BadRequestException('Compositor não encontrado');
    }
    if (instrumentId && !instrument) {
      throw new BadRequestException('Instrumento não encontrado');
    }
    if (epochId && !epoch) {
      throw new BadRequestException('Época não encontrada');
    }

    return {
      composer: composer ?? { name: '', fullName: null },
      instrument: instrument ?? { name: '' },
      epoch: epoch ?? { name: '' },
    };
  }

  /**
   * O envio inteiro, para a tela de edição — do próprio autor, ou de admin.
   *
   * Faltava na API: as páginas `upload/<tipo>/[id]/edit` do front carregam a obra
   * por aqui antes de mostrar o formulário.
   */
  async findForEdit(id: string, userId: string, isAdmin: boolean) {
    await this.findOwnedWork(id, userId, isAdmin);

    return this.prisma.work.findUnique({
      where: { id },
      include: {
        // O retrato aparece no cabeçalho da tela de edição da obra.
        composer: {
          select: { id: true, name: true, fullName: true, portraitUrl: true },
        },
        epoch: { select: { id: true, name: true } },
        instrument: { select: { id: true, name: true } },
      },
    });
  }

  private async findOwnedWork(
    workId: string,
    userId: string,
    isAdmin: boolean,
  ) {
    const work = await this.prisma.work.findUnique({
      where: { id: workId },
      select: { id: true, title: true, createdBy: true },
    });

    if (!work) {
      throw new NotFoundException('Obra não encontrada');
    }

    if (!isAdmin && work.createdBy !== userId) {
      throw new ForbiddenException(
        'Você só pode alterar obras que você mesmo cadastrou',
      );
    }

    return work;
  }

  private async invalidateCatalogCache(): Promise<void> {
    await this.cache.invalidateMany(CATALOG_NAMESPACES);
  }
}
