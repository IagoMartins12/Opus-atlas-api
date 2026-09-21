import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageResourceType } from '@prisma/client';
import {
  v2 as cloudinary,
  UploadApiErrorResponse,
  UploadApiOptions,
  UploadApiResponse,
} from 'cloudinary';
import { errorMessage } from '../utils/error.util';

export interface CloudinaryAsset {
  publicId: string;
  secureUrl: string;
  format?: string;
  bytes?: number;
  width?: number;
  height?: number;
  duration?: number;
  resourceType: string;
}

export interface SignedUploadParams {
  timestamp: number;
  signature: string;
  apiKey: string;
  cloudName: string;
  folder: string;
  publicId: string;
  resourceType: string;
  uploadUrl: string;
  /** Tags já no formato assinado ("a,b"). Entram na assinatura, então o cliente precisa reenviá-las. */
  tags?: string;
}

/** Mapeia o enum do schema para o vocabulário do Cloudinary. */
const RESOURCE_TYPE_MAP: Record<
  StorageResourceType,
  'image' | 'video' | 'raw'
> = {
  IMAGE: 'image',
  VIDEO: 'video',
  RAW: 'raw',
};

export function toCloudinaryResourceType(
  type: StorageResourceType,
): 'image' | 'video' | 'raw' {
  return RESOURCE_TYPE_MAP[type];
}

/**
 * Camada fina sobre o SDK do Cloudinary.
 *
 * Só fala com o provedor: não conhece regra de domínio nem toca no banco.
 * Quem orquestra é o `StorageService`. Isolar assim mantém o provedor
 * substituível e deixa o resto do código testável sem rede.
 */
@Injectable()
export class CloudinaryService implements OnModuleInit {
  private readonly logger = new Logger(CloudinaryService.name);
  private configured = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const cloudName = this.configService.get<string>('storage.cloudName');
    const apiKey = this.configService.get<string>('storage.apiKey');
    const apiSecret = this.configService.get<string>('storage.apiSecret');

    if (!cloudName || !apiKey || !apiSecret) {
      this.logger.warn(
        'Credenciais do Cloudinary ausentes — uploads ficarão indisponíveis. ' +
          'Configure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET.',
      );
      return;
    }

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });

    this.configured = true;
    this.logger.log(`Cloudinary configurado (cloud: ${cloudName})`);
  }

  isConfigured(): boolean {
    return this.configured;
  }

  private assertConfigured(): void {
    if (!this.configured) {
      throw new InternalServerErrorException(
        'Armazenamento de arquivos não configurado neste ambiente',
      );
    }
  }

  /** Envia o conteúdo já em memória. Usado na estratégia `API_PROXY`. */
  async uploadBuffer(
    buffer: Buffer,
    options: {
      folder: string;
      publicId: string;
      resourceType: StorageResourceType;
      tags?: string[];
      context?: Record<string, string>;
    },
  ): Promise<CloudinaryAsset> {
    this.assertConfigured();

    const uploadOptions: UploadApiOptions = {
      folder: options.folder,
      public_id: options.publicId,
      resource_type: toCloudinaryResourceType(options.resourceType),
      overwrite: true,
      // O nome do arquivo enviado pelo usuário nunca vira nome no provedor:
      // evita vazar dado pessoal na URL e colisão por nome repetido.
      use_filename: false,
      unique_filename: false,
      tags: options.tags,
      context: options.context,
      // Sem transformação no upload: transformar sob demanda pela URL é mais
      // rápido para gravar e não gasta processamento em variação que ninguém pede.
      chunk_size: 6_000_000,
      timeout: 120_000,
    };

    try {
      const result = await new Promise<Record<string, unknown>>(
        (resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            uploadOptions,
            (
              error: UploadApiErrorResponse | undefined,
              uploaded: UploadApiResponse | undefined,
            ) => {
              if (error || !uploaded) {
                reject(error ?? new Error('Upload sem resposta do Cloudinary'));
                return;
              }
              resolve(uploaded as unknown as Record<string, unknown>);
            },
          );

          stream.end(buffer);
        },
      );

      return this.toAsset(result);
    } catch (error: unknown) {
      this.logger.error(
        `Falha no upload para ${options.folder}/${options.publicId}: ${errorMessage(error)}`,
      );
      throw new InternalServerErrorException('Falha ao enviar o arquivo');
    }
  }

  /**
   * Assina um upload para o cliente enviar direto ao Cloudinary.
   *
   * O segredo nunca sai do servidor: o que vai para o browser é uma assinatura
   * válida só para aquela pasta, aquele `public_id` e aquele instante. O
   * cliente não consegue escolher outro destino nem reaproveitar a assinatura
   * para um segundo arquivo.
   */
  createSignedUpload(options: {
    folder: string;
    publicId: string;
    resourceType: StorageResourceType;
    tags?: string[];
  }): SignedUploadParams {
    this.assertConfigured();

    const timestamp = Math.round(Date.now() / 1000);
    const cloudName = this.configService.get<string>('storage.cloudName', '');
    const apiKey = this.configService.get<string>('storage.apiKey', '');
    const apiSecret = this.configService.get<string>('storage.apiSecret', '');

    // Todo parâmetro assinado precisa ser reenviado pelo cliente exatamente
    // igual, ou o Cloudinary recusa. Por isso a assinatura cobre só o que
    // define o destino.
    const paramsToSign: Record<string, string | number> = {
      folder: options.folder,
      public_id: options.publicId,
      timestamp,
    };

    const tags = options.tags?.length ? options.tags.join(',') : undefined;
    if (tags) {
      paramsToSign.tags = tags;
    }

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      apiSecret,
    );

    const resourceType = toCloudinaryResourceType(options.resourceType);

    return {
      timestamp,
      signature,
      apiKey,
      cloudName,
      folder: options.folder,
      publicId: options.publicId,
      resourceType,
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
      ...(tags ? { tags } : {}),
    };
  }

  /**
   * Consulta o asset no provedor.
   *
   * É o que fecha o fluxo assinado: sem confirmar contra o Cloudinary, um
   * cliente poderia dizer "terminei" sem ter enviado nada, ou apontar para o
   * arquivo de outra pessoa, e o banco registraria uma URL que não existe.
   */
  async getAsset(
    publicId: string,
    resourceType: StorageResourceType,
  ): Promise<CloudinaryAsset | null> {
    this.assertConfigured();

    try {
      const result = await cloudinary.api.resource(publicId, {
        resource_type: toCloudinaryResourceType(resourceType),
      });

      return this.toAsset(result as unknown as Record<string, unknown>);
    } catch (error: unknown) {
      const message = errorMessage(error);

      if (message.includes('not found') || message.includes('Not Found')) {
        return null;
      }

      this.logger.warn(`Falha ao consultar asset ${publicId}: ${message}`);
      return null;
    }
  }

  /** @returns `true` quando o asset não existe mais no provedor. */
  async deleteAsset(
    publicId: string,
    resourceType: StorageResourceType,
  ): Promise<boolean> {
    this.assertConfigured();

    try {
      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: toCloudinaryResourceType(resourceType),
        invalidate: true,
      });

      // `not found` também é sucesso: o objetivo é que o arquivo não exista.
      return result.result === 'ok' || result.result === 'not found';
    } catch (error: unknown) {
      this.logger.error(`Falha ao remover ${publicId}: ${errorMessage(error)}`);
      return false;
    }
  }

  /** Lista os `public_id` sob um prefixo. Usado na detecção de órfãos. */
  async listByPrefix(
    prefix: string,
    resourceType: StorageResourceType,
    cursor?: string,
  ): Promise<{ publicIds: string[]; nextCursor?: string }> {
    this.assertConfigured();

    const result = await cloudinary.api.resources({
      type: 'upload',
      prefix,
      resource_type: toCloudinaryResourceType(resourceType),
      max_results: 500,
      next_cursor: cursor,
    });

    const resources = (result.resources ?? []) as Array<{ public_id: string }>;

    return {
      publicIds: resources.map((resource) => resource.public_id),
      nextCursor: result.next_cursor as string | undefined,
    };
  }

  /** URL derivada sob demanda, sem gravar variação nova no provedor. */
  buildUrl(
    publicId: string,
    resourceType: StorageResourceType,
    transformation?: {
      width?: number;
      height?: number;
      quality?: string;
      crop?: string;
    },
  ): string {
    return cloudinary.url(publicId, {
      resource_type: toCloudinaryResourceType(resourceType),
      secure: true,
      quality: transformation?.quality ?? 'auto',
      fetch_format: 'auto',
      width: transformation?.width,
      height: transformation?.height,
      crop: transformation?.crop ?? 'limit',
    });
  }

  private toAsset(result: Record<string, unknown>): CloudinaryAsset {
    return {
      publicId: String(result.public_id),
      secureUrl: String(result.secure_url),
      format: result.format ? String(result.format) : undefined,
      bytes: typeof result.bytes === 'number' ? result.bytes : undefined,
      width: typeof result.width === 'number' ? result.width : undefined,
      height: typeof result.height === 'number' ? result.height : undefined,
      duration:
        typeof result.duration === 'number' ? result.duration : undefined,
      resourceType: String(result.resource_type ?? 'image'),
    };
  }
}
