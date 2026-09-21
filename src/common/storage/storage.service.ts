import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  StorageAssetKind,
  StorageAssetStatus,
  StoredAsset,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { errorMessage } from '../utils/error.util';
import { policyFor, UploadStrategy } from './asset-policies';
import { CloudinaryService, SignedUploadParams } from './cloudinary.service';
import { detectFileType, isMimeAllowed } from './file-signature';

export interface UploadTarget {
  kind: StorageAssetKind;
  /** Id da entidade dona (workId, composerId, userId...). Vira subpasta. */
  scopeId: string;
  entityType?: string;
  entityId?: string;
  ownerId?: string;
}

export interface UploadedFile {
  buffer: Buffer;
  originalName: string;
  size: number;
}

/**
 * Serviço de armazenamento da aplicação.
 *
 * Orquestra três coisas que sempre andam juntas e que no legado estavam
 * espalhadas por cada `route.ts`: a política do tipo de arquivo (pasta, limite,
 * formato), o envio ao provedor, e o registro em `StoredAsset` — que é o que
 * torna a remoção confiável depois.
 *
 * Nenhuma regra de domínio mora aqui. Quem decide se o usuário pode enviar é o
 * módulo de domínio; este serviço só sabe guardar e apagar arquivo.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Raiz de todas as pastas, com o ambiente embutido.
   *
   * Dev e produção compartilham a mesma conta Cloudinary. Sem o prefixo, um
   * teste local sobrescreveria ou apagaria arquivo de produção.
   */
  private rootFolder(): string {
    const env = this.configService.get<string>('app.nodeEnv', 'development');
    return `opus/${env}`;
  }

  /** `opus/{env}/{segmento}/{scopeId}` */
  buildFolder(kind: StorageAssetKind, scopeId: string): string {
    const { folderSegment } = policyFor(kind);
    const safeScope = scopeId.replace(/[^A-Za-z0-9_-]/g, '');

    return `${this.rootFolder()}/${folderSegment}/${safeScope}`;
  }

  // ---------------------------------------------------------------------
  // Estratégia API_PROXY — imagem e PDF
  // ---------------------------------------------------------------------

  /**
   * Valida e envia um arquivo que já chegou ao servidor.
   *
   * A validação de tipo é feita pelos **bytes** do arquivo, não pelo
   * `Content-Type` do multipart nem pela extensão: os dois são informados pelo
   * cliente e não valem nada como controle de segurança.
   */
  async uploadFile(
    target: UploadTarget,
    file: UploadedFile,
  ): Promise<StoredAsset> {
    const policy = policyFor(target.kind);

    if (policy.strategy !== UploadStrategy.API_PROXY) {
      throw new BadRequestException(
        `Arquivos do tipo ${target.kind} devem usar upload assinado direto`,
      );
    }

    if (file.size > policy.maxBytes) {
      throw new PayloadTooLargeException(
        `Arquivo excede o limite de ${Math.round(policy.maxBytes / (1024 * 1024))}MB`,
      );
    }

    const detected = detectFileType(file.buffer);

    if (!detected) {
      throw new UnsupportedMediaTypeException(
        'Não foi possível identificar o tipo do arquivo',
      );
    }

    if (!isMimeAllowed(detected, policy.allowedMimeTypes)) {
      throw new UnsupportedMediaTypeException(
        `Tipo de arquivo não aceito: ${detected.mimeType}`,
      );
    }

    const folder = this.buildFolder(target.kind, target.scopeId);
    const publicId = this.generatePublicId(target.kind);

    const asset = await this.cloudinary.uploadBuffer(file.buffer, {
      folder,
      publicId,
      resourceType: policy.resourceType,
      tags: [target.kind.toLowerCase(), target.scopeId],
      context: { kind: target.kind, scopeId: target.scopeId },
    });

    const stored = await this.prisma.storedAsset.create({
      data: {
        publicId: asset.publicId,
        resourceType: policy.resourceType,
        kind: target.kind,
        status: StorageAssetStatus.ACTIVE,
        folder,
        secureUrl: asset.secureUrl,
        format: asset.format,
        bytes: asset.bytes,
        width: asset.width,
        height: asset.height,
        duration: asset.duration,
        entityType: target.entityType,
        entityId: target.entityId,
        ownerId: target.ownerId,
        confirmedAt: new Date(),
      },
    });

    if (policy.replacesPrevious) {
      await this.deletePreviousAssets(target, stored.id);
    }

    return stored;
  }

  // ---------------------------------------------------------------------
  // Estratégia SIGNED_DIRECT — vídeo e áudio
  // ---------------------------------------------------------------------

  /**
   * Primeira metade do upload direto: reserva o destino e devolve a assinatura.
   *
   * A linha em `StoredAsset` nasce `PENDING`. Se o cliente desistir no meio, a
   * pendência fica registrada e a rotina de limpeza a recolhe — em vez de
   * virar um arquivo solto no Cloudinary que ninguém sabe de onde veio, que era
   * o problema que o subsistema de "arquivos órfãos" tentava resolver depois.
   */
  async createSignedUpload(target: UploadTarget): Promise<{
    asset: StoredAsset;
    upload: SignedUploadParams;
    maxBytes: number;
    allowedMimeTypes: readonly string[];
  }> {
    const policy = policyFor(target.kind);

    if (policy.strategy !== UploadStrategy.SIGNED_DIRECT) {
      throw new BadRequestException(
        `Arquivos do tipo ${target.kind} devem ser enviados através da API`,
      );
    }

    const folder = this.buildFolder(target.kind, target.scopeId);
    const publicId = this.generatePublicId(target.kind);

    const upload = this.cloudinary.createSignedUpload({
      folder,
      publicId,
      resourceType: policy.resourceType,
      tags: [target.kind.toLowerCase(), target.scopeId],
    });

    const asset = await this.prisma.storedAsset.create({
      data: {
        // O Cloudinary prefixa a pasta ao `public_id` final.
        publicId: `${folder}/${publicId}`,
        resourceType: policy.resourceType,
        kind: target.kind,
        status: StorageAssetStatus.PENDING,
        folder,
        entityType: target.entityType,
        entityId: target.entityId,
        ownerId: target.ownerId,
      },
    });

    return {
      asset,
      upload,
      maxBytes: policy.maxBytes,
      allowedMimeTypes: policy.allowedMimeTypes,
    };
  }

  /**
   * Segunda metade: confirma que o arquivo chegou mesmo.
   *
   * A confirmação consulta o Cloudinary em vez de acreditar no cliente. Sem
   * isso, bastaria chamar este endpoint sem ter enviado nada para o banco
   * passar a apontar para uma URL inexistente.
   *
   * O limite de tamanho é reconferido aqui: no fluxo direto o servidor não vê
   * os bytes, então esta é a única oportunidade de recusar um arquivo grande
   * demais — e o arquivo é removido do provedor quando isso acontece.
   */
  async confirmUpload(assetId: string, ownerId?: string): Promise<StoredAsset> {
    const asset = await this.prisma.storedAsset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      throw new NotFoundException('Upload não encontrado');
    }

    if (ownerId && asset.ownerId && asset.ownerId !== ownerId) {
      throw new NotFoundException('Upload não encontrado');
    }

    if (asset.status === StorageAssetStatus.ACTIVE) {
      return asset;
    }

    const remote = await this.cloudinary.getAsset(
      asset.publicId,
      asset.resourceType,
    );

    if (!remote) {
      throw new BadRequestException(
        'O arquivo não foi encontrado no armazenamento. Refaça o envio.',
      );
    }

    const policy = policyFor(asset.kind);

    if (remote.bytes && remote.bytes > policy.maxBytes) {
      await this.cloudinary.deleteAsset(asset.publicId, asset.resourceType);
      await this.prisma.storedAsset.update({
        where: { id: asset.id },
        data: { status: StorageAssetStatus.DELETED, deletedAt: new Date() },
      });

      throw new PayloadTooLargeException(
        `Arquivo excede o limite de ${Math.round(policy.maxBytes / (1024 * 1024))}MB`,
      );
    }

    const confirmed = await this.prisma.storedAsset.update({
      where: { id: asset.id },
      data: {
        status: StorageAssetStatus.ACTIVE,
        secureUrl: remote.secureUrl,
        format: remote.format,
        bytes: remote.bytes,
        width: remote.width,
        height: remote.height,
        duration: remote.duration,
        confirmedAt: new Date(),
      },
    });

    if (policy.replacesPrevious) {
      await this.deletePreviousAssets(
        {
          kind: asset.kind,
          scopeId: asset.entityId ?? '',
          entityType: asset.entityType ?? undefined,
          entityId: asset.entityId ?? undefined,
        },
        asset.id,
      );
    }

    return confirmed;
  }

  // ---------------------------------------------------------------------
  // Remoção
  // ---------------------------------------------------------------------

  /**
   * Remove do provedor e marca como removido no registro.
   *
   * A linha não é apagada: ela vira trilha de que o arquivo existiu e foi
   * removido, o que é útil em investigação e em auditoria de conteúdo.
   */
  async deleteAsset(assetId: string): Promise<void> {
    const asset = await this.prisma.storedAsset.findUnique({
      where: { id: assetId },
    });

    if (!asset || asset.status === StorageAssetStatus.DELETED) {
      return;
    }

    const removed = await this.cloudinary.deleteAsset(
      asset.publicId,
      asset.resourceType,
    );

    if (!removed) {
      this.logger.warn(
        `Não foi possível remover ${asset.publicId} do provedor; registro mantido para nova tentativa`,
      );
      return;
    }

    await this.prisma.storedAsset.update({
      where: { id: asset.id },
      data: { status: StorageAssetStatus.DELETED, deletedAt: new Date() },
    });
  }

  /** Remove todos os arquivos de uma entidade. Usado em exclusão em cascata. */
  async deleteByEntity(entityType: string, entityId: string): Promise<number> {
    const assets = await this.prisma.storedAsset.findMany({
      where: { entityType, entityId, status: StorageAssetStatus.ACTIVE },
      select: { id: true },
    });

    for (const asset of assets) {
      await this.deleteAsset(asset.id);
    }

    return assets.length;
  }

  /**
   * Remove o arquivo anterior quando o tipo só admite um por entidade
   * (avatar, retrato de compositor).
   */
  private async deletePreviousAssets(
    target: UploadTarget,
    keepAssetId: string,
  ): Promise<void> {
    const previous = await this.prisma.storedAsset.findMany({
      where: {
        kind: target.kind,
        status: StorageAssetStatus.ACTIVE,
        id: { not: keepAssetId },
        ...(target.entityType && target.entityId
          ? { entityType: target.entityType, entityId: target.entityId }
          : { ownerId: target.ownerId }),
      },
      select: { id: true },
    });

    for (const asset of previous) {
      await this.deleteAsset(asset.id).catch((error: unknown) =>
        this.logger.warn(
          `Falha ao remover arquivo anterior ${asset.id}: ${errorMessage(error)}`,
        ),
      );
    }
  }

  // ---------------------------------------------------------------------
  // Consulta
  // ---------------------------------------------------------------------

  findActiveByEntity(
    entityType: string,
    entityId: string,
  ): Promise<StoredAsset[]> {
    return this.prisma.storedAsset.findMany({
      where: { entityType, entityId, status: StorageAssetStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
    });
  }

  countActiveByOwner(ownerId: string, kind: StorageAssetKind): Promise<number> {
    return this.prisma.storedAsset.count({
      where: { ownerId, kind, status: StorageAssetStatus.ACTIVE },
    });
  }

  buildUrl(
    asset: Pick<StoredAsset, 'publicId' | 'resourceType'>,
    transformation?: { width?: number; height?: number; quality?: string },
  ): string {
    return this.cloudinary.buildUrl(
      asset.publicId,
      asset.resourceType,
      transformation,
    );
  }

  /**
   * Nome único e opaco.
   *
   * O nome original do arquivo nunca é usado: além de poder colidir, ele
   * frequentemente carrega dado pessoal ("cpf-joao.pdf") que acabaria exposto
   * na URL pública.
   */
  private generatePublicId(kind: StorageAssetKind): string {
    return `${kind.toLowerCase()}_${randomUUID()}`;
  }
}
