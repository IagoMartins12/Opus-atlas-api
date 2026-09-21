import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CampaignStatus,
  DifficultyLevel,
  SubscriptionStatus,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { queryBoolean } from '../../../common/utils/query-boolean';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

// Da query vem texto, e a conversão implícita do ValidationPipe já teria
// transformado "false" em `true` antes do `@Transform`: lê o valor cru.
const toBoolean = queryBoolean;

/** Critérios de segmentação — forma fechada, nunca JSON livre. */
export class AudienceSegmentsDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  interests?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  favoriteInstruments?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  favoriteEpochs?: string[];

  @ApiPropertyOptional({ enum: DifficultyLevel })
  @IsOptional()
  @IsEnum(DifficultyLevel)
  experienceLevel?: DifficultyLevel;

  @ApiPropertyOptional({ enum: ['daily', 'weekly', 'monthly'] })
  @IsOptional()
  @IsIn(['daily', 'weekly', 'monthly'])
  frequency?: string;

  @ApiPropertyOptional({ example: 'pt-BR' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  language?: string;

  @ApiPropertyOptional({ description: 'Só quem abriu e-mail desde esta data.' })
  @IsOptional()
  @IsDateString()
  engagedSince?: string;
}

export class CreateCampaignDto {
  @ApiProperty({ example: 'Novidades de março' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @ApiProperty({ example: 'Cinco obras novas no catálogo' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  subject: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  templateId?: string;

  @ApiPropertyOptional({ description: 'Conteúdo próprio, sem template.' })
  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  customHtmlContent?: string;

  @ApiPropertyOptional({
    description:
      'Versão em texto. Obrigatória quando há conteúdo próprio — e-mail sem ' +
      'alternativa em texto é tratado como spam por vários provedores.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  customTextContent?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Envia para toda a base.',
  })
  @IsOptional()
  @IsBoolean()
  targetAll?: boolean;

  @ApiPropertyOptional({ type: AudienceSegmentsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AudienceSegmentsDto)
  targetSegments?: AudienceSegmentsDto;

  @ApiPropertyOptional({ type: [String], description: 'Destinatários exatos.' })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  @ArrayMaxSize(1000)
  targetSubscriberIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  senderName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  replyToEmail?: string;

  @ApiPropertyOptional({ description: 'Agendamento. Precisa estar no futuro.' })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}

export class UpdateCampaignDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  subject?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  templateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  customHtmlContent?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  customTextContent?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  targetAll?: boolean;

  @ApiPropertyOptional({ type: AudienceSegmentsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AudienceSegmentsDto)
  targetSegments?: AudienceSegmentsDto;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  @ArrayMaxSize(1000)
  targetSubscriberIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  senderName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  replyToEmail?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string | null;
}

export class ListCampaignsQueryDto {
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

  @ApiPropertyOptional({ enum: CampaignStatus })
  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

/** Envio de teste, para um endereço escolhido. */
export class SendTestCampaignDto {
  @ApiProperty({ example: 'admin@opusatlas.com' })
  @IsEmail()
  to: string;
}

export const SUBSCRIBER_SORT_FIELDS = [
  'subscribedAt',
  'email',
  'emailOpenCount',
  'avgEngagementScore',
] as const;

export class ListSubscribersQueryDto {
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

  @ApiPropertyOptional({ enum: SubscriptionStatus })
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({
    enum: SUBSCRIBER_SORT_FIELDS,
    default: 'subscribedAt',
    description:
      'Lista fechada: no legado o nome do campo vinha cru da query para o ' +
      '`orderBy`, e qualquer valor inválido virava erro 500.',
  })
  @IsOptional()
  @IsIn(SUBSCRIBER_SORT_FIELDS)
  sortBy?: (typeof SUBSCRIBER_SORT_FIELDS)[number];

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @ApiPropertyOptional({ enum: ['csv', 'json'], default: 'csv' })
  @IsOptional()
  @IsIn(['csv', 'json'])
  format?: 'csv' | 'json';
}

/**
 * Alteração administrativa de um assinante.
 *
 * Lista fechada. O legado fazia `data: { ...body }`, o que deixava reescrever
 * `email`, `userId`, os contadores de engajamento e — o pior —
 * `unsubscribeToken`, que é o que faz funcionar o link de descadastro já
 * enviado nos e-mails anteriores.
 */
export class UpdateSubscriberDto {
  @ApiPropertyOptional({ enum: SubscriptionStatus })
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @ApiPropertyOptional({ enum: ['daily', 'weekly', 'monthly'] })
  @IsOptional()
  @IsIn(['daily', 'weekly', 'monthly'])
  frequency?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  interests?: string[];

  @ApiPropertyOptional({ enum: DifficultyLevel })
  @IsOptional()
  @IsEnum(DifficultyLevel)
  experienceLevel?: DifficultyLevel;
}

export class RemoveSubscriberQueryDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'Apaga o registro em vez de marcar como descadastrado. Só para pedido ' +
      'de exclusão de dados — remover o registro apaga a prova do opt-out.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hardDelete?: boolean;
}
