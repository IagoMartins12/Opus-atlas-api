import { ApiPropertyOptional } from '@nestjs/swagger';
import { IMSLPScoreType, ScoreSource, WorkType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { queryBoolean } from '../../../common/utils/query-boolean';
import {
  ArrayMaxSize,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Qualidade do dado catalogado.
 *
 * Segue `String` no schema, como o tipo das tarefas: promover a enum do Prisma
 * quebraria a leitura de qualquer documento fora da lista. Hoje o campo está
 * nulo nos 19.177 compositores da base, então validar na borda é seguro.
 */
export const DATA_QUALITIES = ['high', 'medium', 'low'] as const;

export type DataQuality = (typeof DATA_QUALITIES)[number];

// Da query vem texto, e a conversão implícita do ValidationPipe já teria
// transformado "false" em `true` antes do `@Transform`: lê o valor cru.
const toBoolean = queryBoolean;

class PaginationQuery {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

export const COMPOSER_SORT_FIELDS = ['name', 'createdAt', 'birthYear'] as const;

export class ListComposersQueryDto extends PaginationQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isVerified?: boolean;

  @ApiPropertyOptional({ enum: DATA_QUALITIES })
  @IsOptional()
  @IsIn(DATA_QUALITIES)
  dataQuality?: DataQuality;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  epochId?: string;

  @ApiPropertyOptional({ enum: COMPOSER_SORT_FIELDS, default: 'createdAt' })
  @ApiPropertyOptional({ description: 'No mínimo N obras no catálogo.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minWorks?: number;

  @ApiPropertyOptional({
    description: 'No máximo N obras. `maxWorks=0`: compositores sem obra.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxWorks?: number;

  @ApiPropertyOptional({ description: 'Tem biografia em português.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasBio?: boolean;

  @ApiPropertyOptional({ description: 'Tem biografia em inglês.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasBioEn?: boolean;

  @ApiPropertyOptional({ description: 'Tem retrato.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasPortrait?: boolean;

  @ApiPropertyOptional({ description: 'Tem datas de nascimento e morte.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasDates?: boolean;

  @ApiPropertyOptional({
    description: 'Cadastrado pela comunidade (true) ou importado (false).',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isCustom?: boolean;

  @ApiPropertyOptional({ description: 'Nacionalidade (contém).' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  nationality?: string;

  @ApiPropertyOptional({ description: 'Entrou no catálogo a partir de (ISO).' })
  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @ApiPropertyOptional({ description: 'Entrou no catálogo até (ISO).' })
  @IsOptional()
  @IsISO8601()
  createdTo?: string;

  @IsOptional()
  @IsIn(COMPOSER_SORT_FIELDS)
  sortBy?: (typeof COMPOSER_SORT_FIELDS)[number];
}

export const WORK_SORT_FIELDS = ['title', 'createdAt'] as const;

export class ListWorksQueryDto extends PaginationQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  composerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  epochId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  instrumentId?: string;

  @ApiPropertyOptional({ enum: WorkType })
  @IsOptional()
  @IsEnum(WorkType)
  workType?: WorkType;

  @ApiPropertyOptional({ description: 'Nível na fonte, de "1" a "12".' })
  @IsOptional()
  @IsString()
  @MaxLength(4)
  difficultyLevel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isVerified?: boolean;

  @ApiPropertyOptional({
    description:
      'Mínimo de favoritos. Filtro por contagem — ver a nota de cobertura na resposta.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minFavorites?: number;

  @ApiPropertyOptional({ description: 'Mínimo de "quero aprender".' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minWantToLearn?: number;

  @ApiPropertyOptional({ description: 'Mínimo de "já aprendi".' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minLearned?: number;

  @ApiPropertyOptional({ description: 'Mínimo de partituras.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minScores?: number;

  @ApiPropertyOptional({ enum: WORK_SORT_FIELDS, default: 'createdAt' })
  @ApiPropertyOptional({ description: 'No máximo N favoritos (0: nenhum).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxFavorites?: number;

  @ApiPropertyOptional({
    description: 'No máximo N pessoas querendo aprender.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxWantToLearn?: number;

  @ApiPropertyOptional({ description: 'No máximo N pessoas que aprenderam.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxLearned?: number;

  @ApiPropertyOptional({
    description: 'Tem partitura (true) ou nenhuma (false).',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasScore?: boolean;

  @ApiPropertyOptional({ description: 'Tem vídeo.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasVideo?: boolean;

  @ApiPropertyOptional({
    description: 'Cadastrada pela comunidade (true) ou importada (false).',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isCustom?: boolean;

  @ApiPropertyOptional({ description: 'Entrou no catálogo a partir de (ISO).' })
  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @ApiPropertyOptional({ description: 'Entrou no catálogo até (ISO).' })
  @IsOptional()
  @IsISO8601()
  createdTo?: string;

  @IsOptional()
  @IsIn(WORK_SORT_FIELDS)
  sortBy?: (typeof WORK_SORT_FIELDS)[number];
}

export class ListScoresQueryDto extends PaginationQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  workId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Partituras das obras deste compositor.',
  })
  @IsOptional()
  @IsMongoId()
  composerId?: string;

  @ApiPropertyOptional({ enum: IMSLPScoreType })
  @IsOptional()
  @IsEnum(IMSLPScoreType)
  type?: IMSLPScoreType;

  @ApiPropertyOptional({ enum: ScoreSource })
  @IsOptional()
  @IsEnum(ScoreSource)
  source?: ScoreSource;

  @ApiPropertyOptional({ description: 'Tem arquivo para baixar.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasFile?: boolean;

  @ApiPropertyOptional({ description: 'Entrou a partir de (ISO).' })
  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @ApiPropertyOptional({ description: 'Entrou até (ISO).' })
  @IsOptional()
  @IsISO8601()
  createdTo?: string;
}

/** "Por onde começar": as obras escolhidas pela equipe, em ordem. */
export class StartingWorksDto {
  @ApiPropertyOptional({ type: [String], maxItems: 3 })
  @IsMongoId({ each: true })
  @ArrayMaxSize(3)
  workIds!: string[];
}

/** Verificação e qualidade — a única escrita administrativa em compositor. */
export class UpdateComposerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @ApiPropertyOptional({
    description:
      'Justificativa. Gravada tanto ao verificar quanto ao retirar a verificação.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  verificationNotes?: string;

  @ApiPropertyOptional({ enum: DATA_QUALITIES })
  @IsOptional()
  @IsIn(DATA_QUALITIES)
  dataQuality?: DataQuality;
}

export class UpdateWorkDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({ description: 'Nível na fonte, de "1" a "12".' })
  @IsOptional()
  @IsString()
  @MaxLength(4)
  difficultyLevel?: string;

  @ApiPropertyOptional({ enum: WorkType })
  @IsOptional()
  @IsEnum(WorkType)
  workType?: WorkType;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  videoUrl?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  instrumentation?: string;

  @ApiPropertyOptional({
    description:
      'Verificação da obra. `Work` não tem campo de nota nem de qualidade — ' +
      'esses existem só em `Composer`.',
  })
  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;
}

export class UpdateScoreDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({ description: 'Desativa sem apagar.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class WorkPeopleQueryDto {
  @ApiPropertyOptional({ enum: ['favoritos', 'quero-aprender', 'aprendidas'] })
  @IsIn(['favoritos', 'quero-aprender', 'aprendidas'])
  kind!: 'favoritos' | 'quero-aprender' | 'aprendidas';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;
}
