import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { MediaType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
// Lê o valor cru da query: com a conversão implícita, "false" chegaria `true`.
import { queryBoolean as toBoolean } from '../../../common/utils/query-boolean';

/**
 * Pastas que o editor usa.
 *
 * **Lista fechada, e nunca vira caminho.** No legado, `folder`, `sessionId` e
 * `articleId` vinham do formulário e entravam direto num `path.join` para
 * gravar em disco: `folder=../../..` gravava o arquivo onde o processo
 * conseguisse escrever. Aqui a pasta só decide o tipo de arquivo aceito.
 */
export const MEDIA_FOLDERS = [
  'thumbnail',
  'content',
  'timeline',
  'gallery',
  'images',
  'audio',
] as const;

export type MediaFolder = (typeof MEDIA_FOLDERS)[number];

export class UploadMediaDto {
  @ApiPropertyOptional({ enum: MEDIA_FOLDERS, default: 'images' })
  @IsOptional()
  @IsIn(MEDIA_FOLDERS)
  folder?: MediaFolder;

  @ApiPropertyOptional({ description: 'Artigo já existente' })
  @IsOptional()
  @IsMongoId()
  articleId?: string;

  @ApiPropertyOptional({
    description:
      'Sessão do formulário de criação, quando o artigo ainda não existe. ' +
      'Os arquivos são adotados pelo artigo quando ele é salvo.',
  })
  @IsOptional()
  @Matches(/^[\w-]{1,80}$/, {
    message: 'sessionId aceita letras, dígitos, hífen e sublinhado',
  })
  sessionId?: string;
}

export class RemoveUploadQueryDto {
  @ApiProperty({ description: 'Endereço devolvido pelo upload' })
  @IsString()
  @MaxLength(2048)
  url!: string;
}

export class ListArticleMediaQueryDto {
  @ApiPropertyOptional({ enum: MediaType })
  @IsOptional()
  @IsEnum(MediaType)
  type?: MediaType;

  @ApiPropertyOptional({
    description: 'Sem o parâmetro, vêm todas — dentro e fora da galeria.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  inGallery?: boolean;
}

export class CreateMediaDto {
  @ApiProperty({ enum: MediaType })
  @IsEnum(MediaType)
  type!: MediaType;

  @ApiProperty({
    description: 'Arquivo do site, http(s); vídeo aceita YouTube',
  })
  @IsString()
  @MaxLength(2048)
  url!: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string | null;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  caption?: string | null;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  credit?: string | null;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  alt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  thumbnailUrl?: string | null;

  @ApiPropertyOptional({ description: 'Segundos' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86_400)
  duration?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20_000)
  width?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20_000)
  height?: number | null;

  @ApiPropertyOptional({ description: 'Bytes' })
  @IsOptional()
  @IsInt()
  @Min(0)
  fileSize?: number | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  order?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isInline?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  inGallery?: boolean;
}

export class UpdateMediaDto extends PartialType(CreateMediaDto) {}

export const GALLERY_CATEGORIES = [
  'all',
  'cover',
  'content',
  'audio',
  'temp',
  'gallery',
  'category',
  'legacy',
] as const;

export type GalleryCategory = (typeof GALLERY_CATEGORIES)[number];

export class GalleryQueryDto {
  @ApiPropertyOptional({ enum: GALLERY_CATEGORIES, default: 'all' })
  @IsOptional()
  @IsIn(GALLERY_CATEGORIES)
  category?: GalleryCategory;

  @ApiPropertyOptional({ enum: ['all', 'used', 'unused'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'used', 'unused'])
  usage?: 'all' | 'used' | 'unused';
}

export class DeleteGalleryDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Endereços, como o painel do legado mandava',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(2048, { each: true })
  fileUrls?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsMongoId({ each: true })
  assetIds?: string[];

  @ApiPropertyOptional({
    default: false,
    description:
      'Apaga mesmo arquivo em uso. Sem isso, arquivo usado por algum artigo ou categoria é recusado.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  force?: boolean;
}
