import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  StorageAssetKind,
  StorageAssetStatus,
  StoredAsset,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../billing/services/subscriptions.service';
import {
  StorageService,
  UploadedFile,
} from '../common/storage/storage.service';
import { CreateSignedUploadDto } from './dto/create-signed-upload.dto';
import { SignedUploadResponseDto } from './dto/signed-upload-response.dto';
import { StoredAssetDto } from './dto/stored-asset.dto';

/**
 * Que tipo de arquivo conta contra qual limite de plano.
 *
 * Esta é a aplicação concreta da regra RN-1 do ROADMAP: `checkFeatureAccess`
 * existia no módulo de cobrança mas nunca era chamado, então nenhum limite de
 * plano valia na prática. O mapa fica num único lugar para a regra não nascer
 * duplicada em cada módulo que aceita arquivo.
 */
const PLAN_LIMITED_KINDS: Partial<
  Record<StorageAssetKind, 'uploadLimit' | 'maxPerformanceVideos'>
> = {
  PERFORMANCE_VIDEO: 'maxPerformanceVideos',
  SCORE_FILE: 'uploadLimit',
};

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async createSignedUpload(
    userId: string,
    dto: CreateSignedUploadDto,
  ): Promise<SignedUploadResponseDto> {
    await this.assertWithinPlanLimit(userId, dto.kind);

    const { asset, upload, maxBytes, allowedMimeTypes } =
      await this.storage.createSignedUpload({
        kind: dto.kind,
        scopeId: dto.scopeId,
        entityType: this.entityTypeFor(dto.kind),
        entityId: dto.scopeId,
        ownerId: userId,
      });

    return {
      assetId: asset.id,
      uploadUrl: upload.uploadUrl,
      // Devolvidos exatamente como entraram na assinatura: qualquer diferença
      // no reenvio faz o provedor recusar o upload.
      fields: {
        api_key: upload.apiKey,
        timestamp: upload.timestamp,
        signature: upload.signature,
        folder: upload.folder,
        public_id: upload.publicId,
        // As tags entram na assinatura: sem elas no reenvio, o Cloudinary
        // responde "Invalid Signature" (todo envio direto falhava assim).
        ...(upload.tags ? { tags: upload.tags } : {}),
      },
      maxBytes,
      allowedMimeTypes: [...allowedMimeTypes],
    };
  }

  async confirmUpload(
    userId: string,
    assetId: string,
  ): Promise<StoredAssetDto> {
    const asset = await this.storage.confirmUpload(assetId, userId);
    return this.toDto(asset);
  }

  async uploadFile(
    userId: string,
    kind: StorageAssetKind,
    scopeId: string,
    file: UploadedFile,
  ): Promise<StoredAssetDto> {
    await this.assertWithinPlanLimit(userId, kind);

    // Partitura e miniatura sobem antes do registro e são adotadas por ele na
    // criação (`claimAsset`), que só aceita arquivo ainda sem dono. Com o
    // `scopeId` como dono, a criação recusava todo arquivo enviado por aqui.
    const adoptedOnCreate =
      kind === StorageAssetKind.SCORE_FILE ||
      kind === StorageAssetKind.SCORE_THUMBNAIL;

    const asset = await this.storage.uploadFile(
      {
        kind,
        scopeId,
        entityType: this.entityTypeFor(kind),
        entityId: adoptedOnCreate ? undefined : scopeId,
        ownerId: userId,
      },
      file,
    );

    return this.toDto(asset);
  }

  /**
   * Remove um arquivo do próprio usuário.
   *
   * Arquivo de outra pessoa responde 404, não 403: dizer "existe, mas não é
   * seu" confirmaria a existência do id para quem está sondando.
   */
  async deleteOwnAsset(userId: string, assetId: string): Promise<void> {
    const asset = await this.prisma.storedAsset.findUnique({
      where: { id: assetId },
      select: { id: true, ownerId: true, status: true },
    });

    if (!asset || asset.ownerId !== userId) {
      throw new NotFoundException('Arquivo não encontrado');
    }

    if (asset.status === StorageAssetStatus.DELETED) {
      return;
    }

    await this.storage.deleteAsset(assetId);
  }

  /**
   * Aplica o limite do plano antes de reservar espaço no armazenamento.
   *
   * A checagem acontece na reserva, não na confirmação: barrar depois do
   * usuário já ter enviado 500MB de vídeo seria desperdiçar a banda dele e a
   * cota do provedor.
   */
  private async assertWithinPlanLimit(
    userId: string,
    kind: StorageAssetKind,
  ): Promise<void> {
    const feature = PLAN_LIMITED_KINDS[kind];

    if (!feature) {
      return;
    }

    const access = await this.subscriptions.checkFeatureAccess(userId, feature);

    if (access.limit === undefined) {
      // Sem limite numérico definido para o plano — ilimitado.
      return;
    }

    const used = await this.storage.countActiveByOwner(userId, kind);

    if (used >= access.limit) {
      throw new ForbiddenException(
        `Limite do plano ${access.plan} atingido (${used}/${access.limit}). ` +
          'Faça upgrade para enviar mais arquivos.',
      );
    }
  }

  /** Entidade dona por tipo de arquivo, usada para busca e exclusão em cascata. */
  private entityTypeFor(kind: StorageAssetKind): string {
    switch (kind) {
      case StorageAssetKind.PROFILE_IMAGE:
        return 'user';
      case StorageAssetKind.COMPOSER_IMAGE:
        return 'composer';
      case StorageAssetKind.SCORE_FILE:
      case StorageAssetKind.SCORE_THUMBNAIL:
        return 'workScore';
      case StorageAssetKind.WORK_AUDIO:
      case StorageAssetKind.WORK_VIDEO_LESSON:
      case StorageAssetKind.PERFORMANCE_VIDEO:
        return 'work';
      case StorageAssetKind.ASSIGNMENT_VIDEO:
        return 'assignment';
      case StorageAssetKind.BLOG_MEDIA:
      case StorageAssetKind.BLOG_AUDIO:
      case StorageAssetKind.BLOG_TTS_AUDIO:
        return 'blogArticle';
      case StorageAssetKind.AD_MEDIA:
        return 'advertisement';
    }
  }

  private toDto(asset: StoredAsset): StoredAssetDto {
    return {
      id: asset.id,
      kind: asset.kind,
      status: asset.status,
      resourceType: asset.resourceType,
      url: asset.secureUrl,
      format: asset.format,
      bytes: asset.bytes,
      width: asset.width,
      height: asset.height,
      duration: asset.duration,
      createdAt: asset.createdAt,
    };
  }
}
