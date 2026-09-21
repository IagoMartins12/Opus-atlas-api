import { randomUUID } from 'crypto';
import { isMongoId } from 'class-validator';
import { scoreGroupsFor } from './score-groups';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ScoreSource,
  StorageAssetKind,
  StorageAssetStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace } from '../../common/cache/cache-keys';
import { StorageService } from '../../common/storage/storage.service';
import {
  RequestContext,
  UploadHistoryService,
} from '../shared/upload-history.service';
import { CreateScoreContributionDto } from './dto/create-score-contribution.dto';
import { UpdateScoreContributionDto } from './dto/update-score-contribution.dto';
import { ActivityTracker } from '../../common/events/activity-tracker.service';

@Injectable()
export class ScoreUploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly history: UploadHistoryService,
    private readonly storage: StorageService,
    private readonly cache: AppCacheService,
    private readonly activity: ActivityTracker,
  ) {}

  async create(
    userId: string,
    dto: CreateScoreContributionDto,
    context: RequestContext,
  ) {
    const work = await this.prisma.work.findUnique({
      where: { id: dto.workId },
      select: { id: true, title: true },
    });

    if (!work) {
      throw new BadRequestException('Obra não encontrada');
    }

    if (dto.assetId && dto.externalUrl) {
      throw new BadRequestException(
        'Envie o arquivo ou o link da partitura, não os dois',
      );
    }

    // Sem arquivo, é partitura por link externo (`CUSTOM`): a API não busca o
    // endereço, só o guarda para o download.
    const file = dto.assetId
      ? await this.claimAsset(dto.assetId, userId, StorageAssetKind.SCORE_FILE)
      : null;

    const thumbnail = dto.thumbnailAssetId
      ? await this.claimAsset(
          dto.thumbnailAssetId,
          userId,
          StorageAssetKind.SCORE_THUMBNAIL,
        )
      : null;

    const score = await this.prisma.workScore.create({
      data: {
        workId: dto.workId,
        // `UPLOAD` distingue arquivo hospedado por nós de link externo
        // (`CUSTOM`) e do IMSLP. É o que permite a uma rotina de limpeza saber
        // o que é seu.
        source: file ? ScoreSource.UPLOAD : ScoreSource.CUSTOM,
        sourceId: file ? `UPLOAD-${file.publicId}` : `CUSTOM-${randomUUID()}`,
        title: dto.title,
        downloadUrl: file ? file.secureUrl : (dto.externalUrl as string),
        thumbnailUrl: thumbnail?.secureUrl ?? null,
        fileSize: file?.bytes ? String(file.bytes) : null,
        fileFormat: dto.fileFormat ?? file?.format?.toUpperCase() ?? 'PDF',
        pageCount: dto.pageCount ?? null,
        editor: dto.editor ?? null,
        publisher: dto.publisher ?? null,
        copyright: dto.copyright ?? null,
        notes: dto.notes ?? null,
        type: dto.type ?? 'SCORES',
        groupIndex: dto.groupIndex ?? 0,
        groupTitle: dto.groupTitle ?? null,
        uploadedBy: userId,
        uploader: userId,
        isCustom: true,
        uploadDate: new Date().toISOString(),
      },
    });

    // Só agora os arquivos ganham dono definitivo: se a criação acima tivesse
    // falhado, eles continuariam órfãos e a limpeza os recolheria.
    await this.attachAssetsToScore(score.id, [file?.id, thumbnail?.id]);

    await this.history.record({
      userId,
      entityType: 'score',
      entityId: score.id,
      action: 'create',
      changes: {
        title: score.title,
        workTitle: work.title,
        workId: work.id,
        fileFormat: score.fileFormat,
        type: score.type,
      },
      context,
    });

    this.activity.track(userId, 'contributions', 'contribution.score.created');

    await this.invalidateCatalogCache();

    return score;
  }

  async update(
    userId: string,
    isAdmin: boolean,
    scoreId: string,
    dto: UpdateScoreContributionDto,
    context: RequestContext,
  ) {
    await this.findOwnedScore(scoreId, userId, isAdmin);

    const data: Prisma.WorkScoreUncheckedUpdateInput = {};
    const changed: Record<string, unknown> = {};

    for (const field of [
      'title',
      'publisher',
      'editor',
      'copyright',
      'pageCount',
      'fileFormat',
      'notes',
      'type',
      'groupIndex',
      'groupTitle',
    ] as const) {
      const value = dto[field];
      if (value !== undefined) {
        (data as Record<string, unknown>)[field] = value;
        changed[field] = value;
      }
    }

    if (dto.thumbnailAssetId) {
      const thumbnail = await this.claimAsset(
        dto.thumbnailAssetId,
        userId,
        StorageAssetKind.SCORE_THUMBNAIL,
      );

      data.thumbnailUrl = thumbnail.secureUrl;
      changed.thumbnailUrl = thumbnail.secureUrl;

      await this.attachAssetsToScore(scoreId, [thumbnail.id]);
    }

    const score = await this.prisma.workScore.update({
      where: { id: scoreId },
      data,
    });

    await this.history.record({
      userId,
      entityType: 'score',
      entityId: scoreId,
      action: 'update',
      changes: changed as Prisma.InputJsonValue,
      context,
    });

    await this.invalidateCatalogCache();

    return score;
  }

  async remove(
    userId: string,
    isAdmin: boolean,
    scoreId: string,
    context: RequestContext,
  ): Promise<void> {
    const score = await this.findOwnedScore(scoreId, userId, isAdmin);

    await this.storage.deleteByEntity('workScore', scoreId);
    await this.prisma.workScore.delete({ where: { id: scoreId } });

    await this.history.record({
      userId,
      entityType: 'score',
      entityId: scoreId,
      action: 'delete',
      changes: { title: score.title },
      context,
    });

    await this.invalidateCatalogCache();
  }

  // -------------------------------------------------------------------

  /**
   * Valida que o arquivo existe, foi enviado por quem está criando o registro,
   * é do tipo esperado e ainda não foi usado em outra partitura.
   *
   * Sem essa checagem, um usuário poderia enviar o `assetId` de outra pessoa e
   * anexar o arquivo dela à própria contribuição.
   */
  private async claimAsset(
    assetId: string,
    userId: string,
    expectedKind: StorageAssetKind,
  ) {
    const asset = await this.prisma.storedAsset.findUnique({
      where: { id: assetId },
    });

    if (!asset || asset.ownerId !== userId) {
      throw new BadRequestException('Arquivo não encontrado');
    }

    if (asset.status !== StorageAssetStatus.ACTIVE) {
      throw new BadRequestException(
        'O envio do arquivo ainda não foi concluído',
      );
    }

    if (asset.kind !== expectedKind) {
      throw new BadRequestException(
        `O arquivo informado não é do tipo ${expectedKind}`,
      );
    }

    if (asset.entityId) {
      throw new BadRequestException(
        'Este arquivo já está associado a outro item',
      );
    }

    if (!asset.secureUrl) {
      throw new BadRequestException('O arquivo não possui URL definitiva');
    }

    return { ...asset, secureUrl: asset.secureUrl };
  }

  private async attachAssetsToScore(
    scoreId: string,
    assetIds: Array<string | undefined>,
  ): Promise<void> {
    const ids = assetIds.filter((id): id is string => Boolean(id));

    if (ids.length === 0) {
      return;
    }

    await this.prisma.storedAsset.updateMany({
      where: { id: { in: ids } },
      data: { entityType: 'workScore', entityId: scoreId },
    });
  }

  /** Grupos da obra e onde encaixar a partitura nova (ver `score-groups`). */
  async groups(workId: string, userId: string) {
    const rows = isMongoId(workId)
      ? await this.prisma.workScore.findMany({
          where: { workId, isActive: true },
          select: {
            groupIndex: true,
            groupTitle: true,
            uploadedBy: true,
            source: true,
          },
        })
      : [];

    return scoreGroupsFor(rows, userId);
  }

  /**
   * O envio inteiro, para a tela de edição — do próprio autor, ou de admin.
   *
   * Faltava na API: as páginas `upload/<tipo>/[id]/edit` do front carregam a partitura
   * por aqui antes de mostrar o formulário.
   */
  async findForEdit(id: string, userId: string, isAdmin: boolean) {
    await this.findOwnedScore(id, userId, isAdmin);

    return this.prisma.workScore.findUnique({
      where: { id },
      include: {
        work: {
          select: {
            id: true,
            title: true,
            composer: { select: { id: true, name: true, fullName: true } },
            epoch: { select: { name: true } },
            instrument: { select: { name: true } },
          },
        },
      },
    });
  }

  private async findOwnedScore(
    scoreId: string,
    userId: string,
    isAdmin: boolean,
  ) {
    const score = await this.prisma.workScore.findUnique({
      where: { id: scoreId },
      select: { id: true, title: true, uploadedBy: true, source: true },
    });

    if (!score) {
      throw new NotFoundException('Partitura não encontrada');
    }

    if (!isAdmin && score.uploadedBy !== userId) {
      throw new ForbiddenException(
        'Você só pode alterar partituras que você mesmo enviou',
      );
    }

    return score;
  }

  private async invalidateCatalogCache(): Promise<void> {
    await this.cache.invalidateMany([CacheNamespace.WORKS]);
  }
}
