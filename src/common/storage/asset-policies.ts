import { StorageAssetKind, StorageResourceType } from '@prisma/client';

/**
 * Como o arquivo chega ao Cloudinary.
 *
 * - `API_PROXY`: o arquivo sobe para o Nest, que valida e repassa. Vale para
 *   imagem e PDF, que são pequenos e onde a validação server-side é barata.
 * - `SIGNED_DIRECT`: a API só assina; o browser envia direto ao Cloudinary e
 *   depois confirma. Vale para vídeo e áudio, onde passar 100MB+ pelo processo
 *   Nest consumiria memória e seguraria uma conexão por minutos.
 */
export enum UploadStrategy {
  API_PROXY = 'API_PROXY',
  SIGNED_DIRECT = 'SIGNED_DIRECT',
}

export interface AssetKindPolicy {
  /** Segmento de pasta, aplicado depois do prefixo de ambiente. */
  folderSegment: string;
  resourceType: StorageResourceType;
  strategy: UploadStrategy;
  maxBytes: number;
  /** MIME types aceitos. A checagem real é por magic bytes, não por este campo. */
  allowedMimeTypes: readonly string[];
  /**
   * Se o arquivo anterior da mesma entidade deve ser removido ao subir um novo.
   * Verdadeiro onde só faz sentido existir um (avatar, retrato de compositor).
   */
  replacesPrevious: boolean;
  /** Exige um dono autenticado. Falso apenas em arquivo gerado pelo sistema. */
  requiresOwner: boolean;
}

const MB = 1024 * 1024;

const IMAGE_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

const SCORE_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

const VIDEO_MIMES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
] as const;

const AUDIO_MIMES = [
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/webm',
] as const;

/**
 * Política por tipo de arquivo — pasta, limite, formatos e forma de envio.
 *
 * Ter isto num único lugar é o que evita que cada rota de upload invente o
 * próprio limite e a própria lista de MIME types, que foi exatamente o que
 * aconteceu no legado (cada `route.ts` com a sua tabela).
 */
export const ASSET_KIND_POLICIES: Record<StorageAssetKind, AssetKindPolicy> = {
  PROFILE_IMAGE: {
    folderSegment: 'profiles',
    resourceType: StorageResourceType.IMAGE,
    strategy: UploadStrategy.API_PROXY,
    maxBytes: 5 * MB,
    allowedMimeTypes: IMAGE_MIMES,
    replacesPrevious: true,
    requiresOwner: true,
  },

  COMPOSER_IMAGE: {
    folderSegment: 'composers',
    resourceType: StorageResourceType.IMAGE,
    strategy: UploadStrategy.API_PROXY,
    maxBytes: 5 * MB,
    allowedMimeTypes: IMAGE_MIMES,
    replacesPrevious: true,
    requiresOwner: true,
  },

  SCORE_FILE: {
    folderSegment: 'scores',
    // PDF entra como `image` no Cloudinary, e não como `raw`: é o que habilita
    // gerar miniatura e servir página avulsa por transformação de URL.
    resourceType: StorageResourceType.IMAGE,
    strategy: UploadStrategy.API_PROXY,
    maxBytes: 25 * MB,
    allowedMimeTypes: SCORE_MIMES,
    replacesPrevious: false,
    requiresOwner: true,
  },

  SCORE_THUMBNAIL: {
    folderSegment: 'scores/thumbnails',
    resourceType: StorageResourceType.IMAGE,
    strategy: UploadStrategy.API_PROXY,
    maxBytes: 5 * MB,
    allowedMimeTypes: IMAGE_MIMES,
    replacesPrevious: true,
    requiresOwner: true,
  },

  WORK_AUDIO: {
    folderSegment: 'works/audio',
    // O Cloudinary trata áudio como `video`.
    resourceType: StorageResourceType.VIDEO,
    strategy: UploadStrategy.SIGNED_DIRECT,
    maxBytes: 50 * MB,
    allowedMimeTypes: AUDIO_MIMES,
    replacesPrevious: false,
    requiresOwner: true,
  },

  WORK_VIDEO_LESSON: {
    folderSegment: 'works/lessons',
    resourceType: StorageResourceType.VIDEO,
    strategy: UploadStrategy.SIGNED_DIRECT,
    maxBytes: 500 * MB,
    allowedMimeTypes: VIDEO_MIMES,
    replacesPrevious: false,
    requiresOwner: true,
  },

  PERFORMANCE_VIDEO: {
    folderSegment: 'performances',
    resourceType: StorageResourceType.VIDEO,
    strategy: UploadStrategy.SIGNED_DIRECT,
    maxBytes: 500 * MB,
    allowedMimeTypes: VIDEO_MIMES,
    replacesPrevious: false,
    requiresOwner: true,
  },

  ASSIGNMENT_VIDEO: {
    folderSegment: 'assignments',
    resourceType: StorageResourceType.VIDEO,
    strategy: UploadStrategy.SIGNED_DIRECT,
    maxBytes: 500 * MB,
    allowedMimeTypes: VIDEO_MIMES,
    replacesPrevious: false,
    requiresOwner: true,
  },

  BLOG_MEDIA: {
    folderSegment: 'blog/media',
    resourceType: StorageResourceType.IMAGE,
    strategy: UploadStrategy.API_PROXY,
    maxBytes: 25 * MB,
    allowedMimeTypes: IMAGE_MIMES,
    replacesPrevious: false,
    requiresOwner: true,
  },

  // Áudio que o autor põe no artigo (player, citação com música de fundo).
  // Passa pelo Nest, e não por upload assinado como o áudio de obra: o legado
  // já limitava a 25 MB, e é o que permite conferir o tipo pelos bytes.
  BLOG_AUDIO: {
    folderSegment: 'blog/audio',
    // O Cloudinary trata áudio como `video`.
    resourceType: StorageResourceType.VIDEO,
    strategy: UploadStrategy.API_PROXY,
    maxBytes: 25 * MB,
    allowedMimeTypes: AUDIO_MIMES,
    replacesPrevious: false,
    requiresOwner: true,
  },

  BLOG_TTS_AUDIO: {
    folderSegment: 'blog/tts',
    resourceType: StorageResourceType.VIDEO,
    strategy: UploadStrategy.API_PROXY,
    maxBytes: 25 * MB,
    allowedMimeTypes: AUDIO_MIMES,
    replacesPrevious: true,
    // Gerado pelo sistema a partir do texto do artigo, não enviado por usuário.
    requiresOwner: false,
  },

  AD_MEDIA: {
    folderSegment: 'ads',
    resourceType: StorageResourceType.IMAGE,
    strategy: UploadStrategy.API_PROXY,
    maxBytes: 25 * MB,
    allowedMimeTypes: IMAGE_MIMES,
    replacesPrevious: false,
    requiresOwner: true,
  },
};

export function policyFor(kind: StorageAssetKind): AssetKindPolicy {
  return ASSET_KIND_POLICIES[kind];
}
