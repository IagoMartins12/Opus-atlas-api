import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ArticleStatus,
  StorageAssetKind,
  StorageAssetStatus,
  StorageResourceType,
} from '@prisma/client';
import { isMongoId } from 'class-validator';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace } from '../../common/cache/cache-keys';
import { policyFor } from '../../common/storage/asset-policies';
import { CloudinaryService } from '../../common/storage/cloudinary.service';
import { StorageService } from '../../common/storage/storage.service';
import { errorMessage } from '../../common/utils/error.util';
import { PrismaService } from '../../prisma/prisma.service';
import { ARTICLE_ASSET_ENTITY } from '../media/blog-media.service';
import { cloudinaryPublicId, concatMp3 } from './mp3';
import { articleSpeechText, splitForSpeech } from './speech-text';
import { SPEECH_SYNTHESIZER, SpeechSynthesizer } from './speech-synthesizer';

/** Voz padrão do legado. */
export const DEFAULT_VOICE = 'pt-BR-Neural2-A';

/**
 * Teto de caracteres lidos por artigo — o teto de **custo**.
 *
 * O Google cobra por caractere. A maior matéria da base tem uns 30 mil. Na
 * velocidade normal quem limita antes é o tamanho do áudio (abaixo); este teto
 * vale nas velocidades rápidas, em que o áudio encolhe e a conta não.
 */
export const MAX_SPEECH_CHARS = 60_000;

/**
 * Bytes de MP3 por caractere de texto, na velocidade normal.
 *
 * Medido contra o Google em 12/09, com a voz padrão: 9.612 caracteres viraram
 * 6.099.840 bytes (12 min 42 s, a 64 kbps) — 635 por caractere. Arredondado
 * para cima, para a estimativa errar do lado seguro.
 */
export const AUDIO_BYTES_PER_CHAR = 700;

const MB = 1024 * 1024;

const ROLE_ADMIN = 1;

/**
 * O áudio "ouvir o artigo".
 *
 * **A rota do legado não tinha autenticação, e o texto vinha do cliente.**
 * Qualquer pessoa disparava síntese paga com o texto que quisesse e, com
 * `regenerate`, trocava o áudio de qualquer matéria pelo próprio texto. Aqui:
 *
 * - pedir o áudio que **já existe** continua aberto a quem lê o artigo — é o
 *   que o front faz ao tocar;
 * - **gerar ou regerar é da administração**, com teto de caracteres;
 * - o texto sai **do artigo**, no servidor. O que vier em `text` é ignorado.
 */
@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cloudinary: CloudinaryService,
    private readonly cache: AppCacheService,
    @Inject(SPEECH_SYNTHESIZER) private readonly synthesizer: SpeechSynthesizer,
  ) {}

  async audio(
    input: {
      articleId: string;
      regenerate?: boolean;
      voiceName?: string;
      speakingRate?: number;
    },
    viewer?: { sub: string; role: number },
  ) {
    const isAdmin = !!viewer && viewer.role >= ROLE_ADMIN;
    const article = await this.requireArticle(input.articleId);

    if (!isAdmin && !isPublished(article)) {
      throw new NotFoundException('Artigo não encontrado');
    }

    if (!input.regenerate && article.ttsAudioUrl) {
      return {
        success: true,
        audioUrl: article.ttsAudioUrl,
        cached: true,
        message: 'Áudio já existe',
      };
    }

    if (!isAdmin) {
      throw new ForbiddenException(
        'O áudio deste artigo ainda não foi gerado. Só a administração gera áudio.',
      );
    }

    const text = articleSpeechText(article);

    if (!text) {
      throw new BadRequestException('O artigo não tem texto para ler');
    }

    if (text.length > MAX_SPEECH_CHARS) {
      throw new BadRequestException(
        `O artigo tem ${text.length} caracteres de texto; o áudio vai até ${MAX_SPEECH_CHARS}.`,
      );
    }

    const speakingRate = input.speakingRate ?? 1;
    this.assertAudioFits(text.length, speakingRate);

    const chunks = splitForSpeech(text);
    const buffers: Buffer[] = [];

    for (const chunk of chunks) {
      buffers.push(
        await this.synthesizer.synthesize(
          chunk,
          input.voiceName ?? DEFAULT_VOICE,
          speakingRate,
        ),
      );
    }

    const audio = concatMp3(buffers);

    // `BLOG_TTS_AUDIO` substitui o anterior do mesmo artigo sozinho.
    const asset = await this.storage.uploadFile(
      {
        kind: StorageAssetKind.BLOG_TTS_AUDIO,
        scopeId: article.id,
        entityType: ARTICLE_ASSET_ENTITY,
        entityId: article.id,
        ownerId: viewer?.sub,
      },
      { buffer: audio, originalName: 'tts.mp3', size: audio.length },
    );

    if (article.ttsAudioUrl && article.ttsAudioUrl !== asset.secureUrl) {
      await this.deleteLegacyAudio(article.ttsAudioUrl);
    }

    await this.prisma.blogArticle.update({
      where: { id: article.id },
      data: { ttsAudioUrl: asset.secureUrl },
    });
    await this.cache.invalidateMany([CacheNamespace.BLOG_ARTICLES]);

    this.logger.log(
      `Áudio do artigo ${article.id} gerado por ${viewer?.sub}: ${text.length} caracteres, ${chunks.length} pedaço(s)`,
    );

    return {
      success: true,
      audioUrl: asset.secureUrl,
      cached: false,
      fileSize: asset.bytes,
      chunks: chunks.length,
      characters: text.length,
      message: `Áudio gerado (${chunks.length} pedaço(s))`,
    };
  }

  async remove(articleId: string) {
    const article = await this.requireArticle(articleId);

    const tracked = await this.prisma.storedAsset.findMany({
      where: {
        entityType: ARTICLE_ASSET_ENTITY,
        entityId: article.id,
        kind: StorageAssetKind.BLOG_TTS_AUDIO,
        status: StorageAssetStatus.ACTIVE,
      },
      select: { id: true, secureUrl: true },
    });

    for (const asset of tracked) {
      await this.storage.deleteAsset(asset.id);
    }

    if (
      article.ttsAudioUrl &&
      !tracked.some((asset) => asset.secureUrl === article.ttsAudioUrl)
    ) {
      await this.deleteLegacyAudio(article.ttsAudioUrl);
    }

    await this.prisma.blogArticle.update({
      where: { id: article.id },
      data: { ttsAudioUrl: null },
    });
    await this.cache.invalidateMany([CacheNamespace.BLOG_ARTICLES]);

    return { success: true, message: 'Áudio apagado' };
  }

  /**
   * Apaga um áudio gerado pelo legado, que não está registrado em
   * `StoredAsset`, pelo identificador certo — ver `cloudinaryPublicId`.
   * Falha aqui não impede o resto: o pior caso é um arquivo sobrando no
   * Cloudinary, que é o que o legado deixava sempre.
   */
  private async deleteLegacyAudio(url: string): Promise<void> {
    const tracked = await this.prisma.storedAsset.findFirst({
      where: { secureUrl: url },
      select: { id: true },
    });

    if (tracked) return;

    const publicId = cloudinaryPublicId(url);

    if (!publicId) return;

    try {
      await this.cloudinary.deleteAsset(publicId, StorageResourceType.VIDEO);
    } catch (error: unknown) {
      this.logger.warn(
        `Áudio antigo não foi apagado do Cloudinary (${publicId}): ${errorMessage(error)}`,
      );
    }
  }

  /**
   * Recusa **antes de sintetizar** o áudio que passaria do limite do upload.
   *
   * O áudio cresce com o texto e com a lentidão da fala: a 0,5, dobra. Sem esta
   * conta, o artigo longo pagava a síntese inteira ao Google e só então era
   * recusado pelo armazenamento.
   */
  private assertAudioFits(chars: number, speakingRate: number): void {
    const estimated = Math.ceil((chars * AUDIO_BYTES_PER_CHAR) / speakingRate);
    const { maxBytes } = policyFor(StorageAssetKind.BLOG_TTS_AUDIO);

    if (estimated <= maxBytes) {
      return;
    }

    const hint =
      speakingRate < 1
        ? 'Use uma velocidade maior.'
        : 'O texto é longo demais para um áudio só.';

    throw new BadRequestException(
      `O áudio deste artigo teria uns ${Math.ceil(estimated / MB)} MB; o limite é ${Math.floor(maxBytes / MB)} MB. ${hint}`,
    );
  }

  private async requireArticle(id: string) {
    if (!isMongoId(id)) {
      throw new NotFoundException('Artigo não encontrado');
    }

    const article = await this.prisma.blogArticle.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        content: true,
        status: true,
        publishedAt: true,
        ttsAudioUrl: true,
      },
    });

    if (!article) {
      throw new NotFoundException('Artigo não encontrado');
    }

    return article;
  }
}

function isPublished(article: {
  status: ArticleStatus;
  publishedAt: Date | null;
}): boolean {
  return (
    article.status === ArticleStatus.PUBLISHED &&
    !!article.publishedAt &&
    article.publishedAt.getTime() <= Date.now()
  );
}
