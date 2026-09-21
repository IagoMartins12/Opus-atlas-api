import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Campos que a comunidade pode enviar ao cadastrar uma obra.
 *
 * Lista explícita pelo mesmo motivo do cadastro de compositor: o handler do
 * legado fazia `prisma.work.create({ data: { ...body } })`, o que permitia
 * enviar `isVerified`, `verifiedBy` ou `verificationStatus` e forjar uma obra
 * como verificada. Aqui esses campos nem chegam ao service.
 */
export class CreateWorkContributionDto {
  @ApiProperty({ example: 'Sonata para Piano nº 14' })
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  title: string;

  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  @IsMongoId()
  composerId: string;

  @ApiProperty({ example: '685d591c1e3db0c5aaa893e5' })
  @IsMongoId()
  instrumentId: string;

  @ApiProperty({ example: '685d591c1e3db0c5aaa893e6' })
  @IsMongoId()
  epochId: string;

  @ApiPropertyOptional({ example: 'Ao Luar' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  subtitle?: string;

  @ApiPropertyOptional({ example: 'Op. 27 No. 2' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  opOrCatalog?: string;

  @ApiPropertyOptional({ example: '1801' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  compositionYear?: string;

  @ApiPropertyOptional({ example: '1802' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstPublishDate?: string;

  @ApiPropertyOptional({ example: 'Dó sustenido menor' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  tone?: string;

  @ApiPropertyOptional({ example: '15:00' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  mediaDuration?: string;

  @ApiPropertyOptional({ example: 'Romântico' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  workStyle?: string;

  @ApiPropertyOptional({ example: 'Adagio sostenuto' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  moviment?: string;

  @ApiPropertyOptional({ example: 'Condessa Giulietta Guicciardi' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  dedicateTo?: string;

  @ApiPropertyOptional({ example: 'Piano solo' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  instrumentation?: string;

  @ApiPropertyOptional({ enum: WorkType, default: WorkType.INDIVIDUAL })
  @IsOptional()
  @IsEnum(WorkType)
  workType?: WorkType;

  @ApiPropertyOptional({
    example: 1,
    description: 'Número do movimento, em obra com partes.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  movementNumber?: number;

  @ApiPropertyOptional({ description: 'Obra-mãe, quando esta é um movimento.' })
  @IsOptional()
  @IsMongoId()
  parentWorkId?: string;

  @ApiPropertyOptional({ type: [String], example: ['Sonatas'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryNames?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Sonata'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  workGenresArr?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imslpTags?: string[];

  @ApiPropertyOptional({ example: 'https://imslp.org/wiki/Piano_Sonata_No.14' })
  @IsOptional()
  @IsUrl()
  @MaxLength(1000)
  imslpPermlink?: string;

  @ApiPropertyOptional({
    example: 'Piano_Sonata_No.14_(Beethoven,_Ludwig_van)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imslpId?: string;

  @ApiPropertyOptional({ example: 'https://youtube.com/watch?v=abc' })
  @IsOptional()
  @IsUrl()
  @MaxLength(1000)
  videoUrl?: string;

  // --- Mídia associada ---

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  spotifyTrackId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  @MaxLength(1000)
  spotifyTrackUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  youtubeVideoId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  @MaxLength(1000)
  youtubeVideoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  youtubeTitle?: string;

  @ApiPropertyOptional({ description: 'Áudio próprio já hospedado.' })
  @IsOptional()
  @IsUrl()
  @MaxLength(1000)
  customAudioUrl?: string;

  @ApiPropertyOptional({ description: 'Vídeo aula já hospedado.' })
  @IsOptional()
  @IsUrl()
  @MaxLength(1000)
  videoAulaUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  videoAulaTitle?: string;

  @ApiPropertyOptional({ example: 'video' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  videoAulaType?: string;

  @ApiPropertyOptional({ example: 'youtube' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  videoAulaSource?: string;

  @ApiPropertyOptional({ example: 'manual' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  dataSource?: string;
}
