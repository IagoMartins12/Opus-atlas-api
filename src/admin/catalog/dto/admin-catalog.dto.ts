import { ApiPropertyOptional } from '@nestjs/swagger';
import { WorkType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { queryBoolean } from '../../../common/utils/query-boolean';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
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
