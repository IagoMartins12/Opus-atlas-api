import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateWorkMediaDto {
  @ApiPropertyOptional({ description: 'ID da faixa no Spotify' })
  @IsOptional()
  @IsString()
  spotifyTrackId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  spotifyTrackUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  spotifyDisplayTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  spotifyDuration?: number;

  @ApiPropertyOptional()
  @IsOptional()
  spotifyArtists?: unknown;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  spotifyThumbnail?: string;

  @ApiPropertyOptional({ description: 'ID do vídeo no YouTube' })
  @IsOptional()
  @IsString()
  youtubeVideoId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  youtubeVideoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  youtubeTitle?: string;

  @ApiPropertyOptional({
    description:
      'URL de áudio customizado — upload próprio ou fonte alternativa já resolvida ' +
      '(ver `MediaSearchModule`)',
  })
  @IsOptional()
  @IsString()
  customAudioUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customAudioFile?: string;

  @ApiPropertyOptional({ example: 'upload', enum: ['upload', 'alternative'] })
  @IsOptional()
  @IsString()
  customAudioSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  customAudioMetadata?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Remove todo o áudio customizado atual' })
  @IsOptional()
  @IsBoolean()
  removeCustomAudio?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  videoAulaUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  videoAulaFile?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  videoAulaTitle?: string;

  @ApiPropertyOptional({ example: 'video' })
  @IsOptional()
  @IsString()
  videoAulaType?: string;

  @ApiPropertyOptional({ example: 'youtube' })
  @IsOptional()
  @IsString()
  videoAulaSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  videoAulaMetadata?: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'manual' })
  @IsOptional()
  @IsString()
  mediaSource?: string;
}
