import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class WorkDetailParentComposerDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Beethoven' })
  name: string;

  @ApiProperty({ example: 'Ludwig van Beethoven' })
  fullName: string;
}

class WorkDetailParentWorkDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Sonata No. 14' })
  title: string;

  @ApiProperty({ type: WorkDetailParentComposerDto })
  composer: WorkDetailParentComposerDto;
}

class WorkDetailChildWorkDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Allegro' })
  title: string;

  @ApiPropertyOptional({ nullable: true })
  subtitle?: string | null;
}

class WorkDetailComposerDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Beethoven' })
  name: string;

  @ApiProperty({ example: 'Ludwig van Beethoven' })
  fullName: string;

  @ApiPropertyOptional({ example: 'Clássico', nullable: true })
  epochName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  portraitUrl?: string | null;
}

class WorkDetailInstrumentDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Piano' })
  name: string;
}

class WorkDetailEpochDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Romântico' })
  name: string;
}

export class WorkDetailDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Sonata No. 2 em Si bemol menor' })
  title: string;

  @ApiPropertyOptional({ nullable: true })
  subtitle?: string | null;

  @ApiPropertyOptional({ nullable: true })
  opOrCatalog?: string;

  @ApiPropertyOptional({ nullable: true })
  compositionYear?: string;

  @ApiPropertyOptional({ nullable: true })
  firstPublishDate?: string;

  @ApiPropertyOptional({ nullable: true })
  tone?: string;

  @ApiPropertyOptional({ nullable: true })
  mediaDuration?: string;

  @ApiProperty({ example: 'https://imslp.org/wiki/...' })
  imslpPermlink: string;

  @ApiProperty({ example: 'Category:Beethoven,_Ludwig_van' })
  imslpId: string;

  @ApiPropertyOptional({ nullable: true })
  videoUrl?: string;

  @ApiPropertyOptional({ nullable: true })
  workStyle?: string;

  @ApiPropertyOptional({ nullable: true })
  moviment?: string;

  @ApiPropertyOptional({ nullable: true })
  dedicateTo?: string;

  @ApiPropertyOptional({ nullable: true })
  instrumentation?: string;

  @ApiProperty({ example: 'INDIVIDUAL' })
  workType: string;

  @ApiPropertyOptional({ nullable: true })
  movementNumber?: number;

  @ApiProperty({ example: '2026-09-06T12:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: true })
  isVerified: boolean;

  @ApiPropertyOptional({ nullable: true })
  createdBy?: string | null;

  @ApiPropertyOptional({ nullable: true })
  parentWorkId?: string | null;

  @ApiPropertyOptional({ type: WorkDetailParentWorkDto, nullable: true })
  parentWork?: WorkDetailParentWorkDto | null;

  @ApiProperty({ type: [WorkDetailChildWorkDto] })
  childWorks: WorkDetailChildWorkDto[];

  @ApiPropertyOptional({ nullable: true })
  spotifyTrackId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  spotifyTrackUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  spotifyDisplayTitle?: string | null;

  @ApiPropertyOptional({ nullable: true })
  spotifyDuration?: number | null;

  @ApiPropertyOptional({ type: 'object', nullable: true })
  spotifyArtists?: unknown;

  @ApiPropertyOptional({ nullable: true })
  spotifyThumbnail?: string | null;

  @ApiPropertyOptional({ nullable: true })
  youtubeVideoId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  youtubeVideoUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  youtubeTitle?: string | null;

  @ApiPropertyOptional({ nullable: true })
  videoAulaUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  videoAulaFile?: string | null;

  @ApiPropertyOptional({ type: 'object', nullable: true })
  videoAulaMetadata?: unknown;

  @ApiPropertyOptional({ nullable: true })
  videoAulaSource?: string | null;

  @ApiPropertyOptional({ nullable: true })
  videoAulaTitle?: string | null;

  @ApiPropertyOptional({ nullable: true })
  videoAulaType?: string | null;

  @ApiPropertyOptional({ example: '2026-09-06T12:00:00.000Z', nullable: true })
  videoAulaAddedAt?: Date | null;

  @ApiPropertyOptional({ nullable: true })
  videoAulaAddedBy?: string | null;

  @ApiPropertyOptional({ nullable: true })
  customAudioUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  customAudioFile?: string | null;

  @ApiPropertyOptional({ type: 'object', nullable: true })
  customAudioMetadata?: unknown;

  @ApiPropertyOptional({ nullable: true })
  customAudioSource?: string | null;

  @ApiPropertyOptional({ nullable: true })
  mediaSource?: string | null;

  @ApiPropertyOptional({ example: '2026-09-06T12:00:00.000Z', nullable: true })
  lastMediaSearch?: Date | null;

  @ApiPropertyOptional({ nullable: true })
  mediaSearchError?: string | null;

  @ApiPropertyOptional({ nullable: true })
  difficultyLevel?: string | null;

  @ApiProperty({ type: WorkDetailComposerDto })
  composer: WorkDetailComposerDto;

  @ApiPropertyOptional({ type: WorkDetailInstrumentDto, nullable: true })
  instrument: WorkDetailInstrumentDto | null;

  @ApiPropertyOptional({ type: WorkDetailEpochDto, nullable: true })
  epoch: WorkDetailEpochDto | null;

  @ApiProperty({ type: [String] })
  categoryNames: string[];

  @ApiProperty({ type: [String] })
  workGenresArr: string[];
}
