import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ArticleStatus, ArticleType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MAX_FEATURED } from '../article-featured';
import { PUBLISH_ACTIONS, PublishAction } from '../article-status';
import { SLUG_PATTERN } from '../article-text';

const MAX_LINKED = 100;

/**
 * Lista de ids do catálogo.
 *
 * O formato é conferido aqui porque os campos são `@db.ObjectId`: no legado,
 * um id malformado chegava ao Prisma e virava 500.
 */
function IdList(description: string) {
  return applyDecorators(
    ApiPropertyOptional({ type: [String], description }),
    IsOptional(),
    IsArray(),
    ArrayMaxSize(MAX_LINKED),
    IsMongoId({ each: true }),
  );
}

export class BackgroundMusicDto {
  @ApiPropertyOptional({
    description: 'Arquivo do site ou endereço do YouTube',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string | null;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 1, default: 0.3 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  volume?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  loop?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  autoplay?: boolean;
}

export class CreateArticleDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({
    example: 'tudo-sobre-frederic-chopin',
    description:
      'Minúsculas, dígitos e hífens simples. Único entre os artigos.',
  })
  @IsString()
  @MaxLength(120)
  @Matches(SLUG_PATTERN, {
    message:
      'slug aceita só letras minúsculas, dígitos e hífens simples (ex.: "tudo-sobre-chopin")',
  })
  slug!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'JSON do editor (TipTap/ProseMirror), começando por `{ "type": "doc" }`. ' +
      'Passa pela política de conteúdo: bloco de tipo desconhecido é recusado, ' +
      'atributo desconhecido é descartado, e endereços e textos de bloco são ' +
      'validados pelo contexto em que o leitor do blog os exibe.',
  })
  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Arquivo do site ou endereço http(s)' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  coverImage?: string | null;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  coverImageAlt?: string | null;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  coverImageCredit?: string | null;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 600,
    description: 'Tempo de leitura informado à mão, em minutos',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  readTime?: number;

  @ApiPropertyOptional({ enum: ArticleStatus, default: ArticleStatus.DRAFT })
  @IsOptional()
  @IsEnum(ArticleStatus)
  status?: ArticleStatus;

  @ApiPropertyOptional({
    description:
      'Obrigatória com `status: SCHEDULED`, e precisa estar no futuro.',
  })
  @IsOptional()
  @IsDateString()
  scheduledFor?: string | null;

  @ApiPropertyOptional({
    description: `Entra no carrossel de destaques (máx. ${MAX_FEATURED})`,
  })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_FEATURED,
    description:
      'Posição no carrossel. Sem ela, o artigo entra na menor livre.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_FEATURED)
  featuredOrder?: number;

  @ApiPropertyOptional({ enum: ArticleType, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsEnum(ArticleType, { each: true })
  types?: ArticleType[];

  @IdList('Categorias do artigo. Todas precisam existir.')
  categoryIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Nomes das tags. As que não existem são criadas; nomes que dão o mesmo slug contam como uma tag só.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(60, { each: true })
  tags?: string[];

  @IdList('Compositores citados')
  composerIds?: string[];

  @IdList('Obras citadas')
  workIds?: string[];

  @IdList('Instrumentos citados')
  instrumentIds?: string[];

  @IdList('Épocas citadas')
  epochIds?: string[];

  @IdList('Coautores')
  coAuthorIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Partituras citadas (`WorkScore.sourceId`, que não é ObjectId)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LINKED)
  @Matches(/^[\w.:-]{1,120}$/, { each: true })
  scoreIds?: string[];

  @ApiPropertyOptional({ type: BackgroundMusicDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BackgroundMusicDto)
  backgroundMusic?: BackgroundMusicDto | null;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  metaTitle?: string | null;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  metaDescription?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  keywords?: string[];
}

export class UpdateArticleDto extends PartialType(CreateArticleDto) {
  @ApiPropertyOptional({
    maxLength: 500,
    description: 'O que mudou. Fica gravado na versão.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeLog?: string;

  @ApiPropertyOptional({
    minimum: 1,
    description:
      'Versão que o editor abriu. Se o artigo já estiver em outra, a gravação ' +
      'é recusada com 409 — em vez de apagar em silêncio o que outra pessoa ' +
      'gravou no meio tempo.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

export class PublishArticleDto {
  @ApiProperty({ enum: PUBLISH_ACTIONS })
  @IsIn(PUBLISH_ACTIONS)
  action!: PublishAction;

  @ApiPropertyOptional({ description: 'Obrigatória em `schedule`; no futuro.' })
  @IsOptional()
  @IsDateString()
  scheduledFor?: string;
}

export class FeatureArticleDto {
  @ApiProperty()
  @IsBoolean()
  isFeatured!: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_FEATURED })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_FEATURED)
  featuredOrder?: number;
}

export class FeaturedOrderDto {
  @ApiProperty()
  @IsMongoId()
  id!: string;

  @ApiProperty({ minimum: 1, maximum: MAX_FEATURED })
  @IsInt()
  @Min(1)
  @Max(MAX_FEATURED)
  featuredOrder!: number;
}

export class ReorderFeaturedDto {
  @ApiProperty({ type: [FeaturedOrderDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_FEATURED)
  @ValidateNested({ each: true })
  @Type(() => FeaturedOrderDto)
  articles!: FeaturedOrderDto[];
}
