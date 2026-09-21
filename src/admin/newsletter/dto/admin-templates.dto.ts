import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmailTemplateType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { queryBoolean } from '../../../common/utils/query-boolean';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsHexColor,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// Da query vem texto, e a conversão implícita do ValidationPipe já teria
// transformado "false" em `true` antes do `@Transform`: lê o valor cru.
const toBoolean = queryBoolean;

/** Nome de variável de template: o que cabe dentro de `{{ }}`. */
const VARIABLE_NAME = /^[a-zA-Z0-9_]{1,40}$/;

export class ListTemplatesQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: EmailTemplateType })
  @IsOptional()
  @IsEnum(EmailTemplateType)
  type?: EmailTemplateType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class CreateTemplateDto {
  @ApiProperty({ example: 'Boas-vindas' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @ApiProperty({ enum: EmailTemplateType })
  @IsEnum(EmailTemplateType)
  type: EmailTemplateType;

  @ApiProperty({ example: 'Bem-vindo ao Opus Atlas, {{firstName}}' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  subject: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200_000)
  htmlContent: string;

  @ApiProperty({
    description:
      'Versão em texto. Obrigatória: e-mail só-HTML é tratado como spam por ' +
      'vários provedores.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100_000)
  textContent: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Variáveis disponíveis, sem as chaves. Ex.: `firstName`.',
  })
  @IsOptional()
  @IsArray()
  @Matches(VARIABLE_NAME, { each: true })
  @ArrayMaxSize(50)
  variables?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  senderName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  replyToEmail?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ enum: EmailTemplateType })
  @IsOptional()
  @IsEnum(EmailTemplateType)
  type?: EmailTemplateType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  subject?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200_000)
  htmlContent?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100_000)
  textContent?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @Matches(VARIABLE_NAME, { each: true })
  @ArrayMaxSize(50)
  variables?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  senderName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  replyToEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * Remoção em lote.
 *
 * É `POST`, não `DELETE` com corpo. O legado mandava os ids no corpo de um
 * `DELETE` — proxies e intermediários costumam descartar corpo em `DELETE`, e
 * o pedido chega sem os ids.
 */
export class BulkDeleteTemplatesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsMongoId({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  templateIds: string[];
}

export class CreateTestListDto {
  @ApiProperty({ example: 'Equipe interna' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ type: [String], example: ['ana@opusatlas.com'] })
  @IsArray()
  @IsEmail({}, { each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  emails: string[];

  @ApiPropertyOptional({ example: '#6366f1' })
  @IsOptional()
  @IsHexColor()
  color?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateTestListDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  @ArrayMaxSize(200)
  emails?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsHexColor()
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export const ANALYTICS_PERIODS = ['7d', '30d', '90d', '1y'] as const;

export class NewsletterAnalyticsQueryDto {
  @ApiPropertyOptional({ enum: ANALYTICS_PERIODS, default: '30d' })
  @IsOptional()
  @IsIn(ANALYTICS_PERIODS)
  period?: (typeof ANALYTICS_PERIODS)[number];

  @ApiPropertyOptional({ enum: ['csv', 'json'], default: 'json' })
  @IsOptional()
  @IsIn(['csv', 'json'])
  format?: 'csv' | 'json';
}
