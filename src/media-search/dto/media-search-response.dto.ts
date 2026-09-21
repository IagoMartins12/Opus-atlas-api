import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class MediaSearchSpotifyDto {
  @ApiProperty({ example: '3n3Ppam7vgaVa1iaRUc9Lp' })
  trackId: string;

  @ApiProperty({
    example: 'https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp',
  })
  trackUrl: string;

  @ApiPropertyOptional({
    example: 'Ludwig van Beethoven - Yuja Wang',
    nullable: true,
  })
  displayTitle?: string | null;

  @ApiPropertyOptional({
    example: 'https://p.scdn.co/mp3-preview/example',
    nullable: true,
  })
  previewUrl?: string | null;

  @ApiPropertyOptional({
    example: 'https://i.scdn.co/image/example',
    nullable: true,
  })
  albumArt?: string | null;

  @ApiPropertyOptional({
    example: 'https://i.scdn.co/image/example',
    nullable: true,
  })
  thumbnail?: string | null;

  @ApiProperty({
    type: [String],
    example: ['Ludwig van Beethoven', 'Yuja Wang'],
  })
  artists: string[];

  @ApiPropertyOptional({ example: 'Beethoven: Piano Sonatas', nullable: true })
  albumName?: string | null;

  @ApiPropertyOptional({ example: 930000, nullable: true })
  duration?: number | null;

  @ApiPropertyOptional({ example: 67, nullable: true })
  popularity?: number | null;
}

class MediaSearchYouTubeDto {
  @ApiProperty({ example: 'dQw4w9WgXcQ' })
  videoId: string;

  @ApiProperty({ example: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
  videoUrl: string;

  @ApiPropertyOptional({
    example: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
    nullable: true,
  })
  thumbnail?: string | null;

  @ApiProperty({ example: 'Beethoven - Moonlight Sonata' })
  title: string;

  @ApiPropertyOptional({ example: 'Classical Vault', nullable: true })
  channel?: string | null;

  @ApiPropertyOptional({ example: '2024-02-10T14:33:00.000Z', nullable: true })
  publishedAt?: string | null;
}

class AlternativeAudioSourceDto {
  @ApiProperty({ example: 'Wikimedia Commons' })
  source: string;

  @ApiProperty({ example: 'https://upload.wikimedia.org/audio/example.ogg' })
  audioUrl: string;

  @ApiPropertyOptional({ example: 345000, nullable: true })
  duration?: number | null;

  @ApiPropertyOptional({ example: '320kbps MP3', nullable: true })
  quality?: string | null;

  @ApiPropertyOptional({ example: 'Public Domain', nullable: true })
  license?: string | null;

  @ApiPropertyOptional({ example: 'Moonlight Sonata', nullable: true })
  title?: string | null;

  @ApiPropertyOptional({ example: 'Beethoven', nullable: true })
  artist?: string | null;

  @ApiPropertyOptional({ example: '5.2MB', nullable: true })
  fileSize?: string | null;

  @ApiPropertyOptional({ example: 'audio/mpeg', nullable: true })
  format?: string | null;

  @ApiPropertyOptional({ example: '2026-09-06T10:00:00.000Z', nullable: true })
  validatedAt?: string | null;

  @ApiPropertyOptional({ example: 'audio/ogg', nullable: true })
  contentType?: string | null;

  @ApiPropertyOptional({ example: '5481234', nullable: true })
  contentLength?: string | null;
}

class MediaSearchMetadataDto {
  @ApiPropertyOptional({ example: 1284, nullable: true })
  processingTime?: number | null;

  @ApiPropertyOptional({ example: 4, nullable: true })
  alternativeSourcesFound?: number | null;

  @ApiPropertyOptional({ example: true, nullable: true })
  spotifyThumbnailSaved?: boolean | null;

  @ApiPropertyOptional({ example: true, nullable: true })
  audioSourceSaved?: boolean | null;

  @ApiPropertyOptional({
    example: 'https://upload.wikimedia.org/audio/example.ogg',
    nullable: true,
  })
  savedAudioUrl?: string | null;

  @ApiPropertyOptional({ example: 'Wikimedia Commons', nullable: true })
  savedAudioSource?: string | null;
}

export class MediaSearchResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiPropertyOptional({ example: 'Mídia já existe', nullable: true })
  message?: string;

  @ApiPropertyOptional({
    example: 'Esta obra não é válida para busca automática.',
    nullable: true,
  })
  error?: string;

  @ApiPropertyOptional({ type: MediaSearchSpotifyDto, nullable: true })
  spotify?: MediaSearchSpotifyDto | null;

  @ApiPropertyOptional({ type: MediaSearchYouTubeDto, nullable: true })
  youtube?: MediaSearchYouTubeDto | null;

  @ApiProperty({ type: [AlternativeAudioSourceDto] })
  alternativeAudio: AlternativeAudioSourceDto[];

  @ApiPropertyOptional({ type: MediaSearchMetadataDto, nullable: true })
  metadata?: MediaSearchMetadataDto;
}
