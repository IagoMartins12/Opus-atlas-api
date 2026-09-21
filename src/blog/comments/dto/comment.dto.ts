import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommentStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
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
} from 'class-validator';
import {
  REPORT_CATEGORIES,
  REPORT_CATEGORY_IDS,
  ReportCategory,
} from '../../../uploads/moderation/report-categories';
import { COMMENT_MAX_LENGTH, COMMENT_MIN_LENGTH } from '../comment-text';
import { COMMENT_SORTS, CommentSort } from '../comment-tree';
import { queryBoolean } from '../../../common/utils/query-boolean';

// O limite de verdade é conferido depois de normalizar o texto; este teto só
// impede que um corpo gigante chegue até lá.
const RAW_MAX = COMMENT_MAX_LENGTH * 2;

export class CreateCommentDto {
  @ApiProperty({
    minLength: COMMENT_MIN_LENGTH,
    maxLength: COMMENT_MAX_LENGTH,
    description:
      'Texto puro. É gravado como foi escrito — quem exibe escapa. Sem HTML.',
  })
  @IsString()
  @MaxLength(RAW_MAX)
  content!: string;

  @ApiPropertyOptional({
    description:
      'Comentário respondido. Precisa ser do mesmo artigo e estar no ar.',
  })
  @IsOptional()
  @IsMongoId()
  parentId?: string;
}

export class UpdateCommentDto {
  @ApiProperty({ minLength: COMMENT_MIN_LENGTH, maxLength: COMMENT_MAX_LENGTH })
  @IsString()
  @MaxLength(RAW_MAX)
  content!: string;
}

export class ListCommentsQueryDto {
  @ApiPropertyOptional({ enum: COMMENT_SORTS, default: 'newest' })
  @IsOptional()
  @IsIn(COMMENT_SORTS)
  sortBy?: CommentSort = 'newest';
}

/**
 * Como os motivos que o formulário do legado oferece viram categoria.
 *
 * Nenhum deles vira categoria grave: "linguagem de ódio" vai para `offensive`
 * (prazo de três dias), não para `illegal`. Uma categoria grave tira o
 * comentário do ar na hora, e cada uma é um botão que qualquer usuário aperta
 * sozinho (RN-4).
 */
export const LEGACY_REASON_CATEGORIES: Record<string, ReportCategory> = {
  'Conteúdo ofensivo ou impróprio': 'offensive',
  'Spam ou propaganda': 'spam',
  'Informações falsas ou enganosas': 'wrong_data',
  'Linguagem de ódio ou discriminação': 'offensive',
  'Conteúdo violento ou perturbador': 'offensive',
  'Outro motivo': 'other',
};

export class ReportCommentDto {
  @ApiProperty({
    enum: REPORT_CATEGORY_IDS,
    example: 'offensive',
    description:
      'Categoria da denúncia (RN-4) — ela decide a prioridade e o prazo; ' +
      'quem denuncia não escolhe a urgência. Só `copyright` e `illegal` tiram ' +
      'o comentário do ar na hora. Categorias: ' +
      REPORT_CATEGORY_IDS.map(
        (id) => `\`${id}\` (${REPORT_CATEGORIES[id].label})`,
      ).join(', ') +
      '.',
  })
  @IsIn(REPORT_CATEGORY_IDS)
  category!: ReportCategory;

  @ApiProperty({ example: 'Conteúdo ofensivo ou impróprio' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export const COMMENT_MODERATION_ACTIONS = [
  'approve',
  'reject',
  'spam',
] as const;

export type CommentModerationAction =
  (typeof COMMENT_MODERATION_ACTIONS)[number];

export class ModerateCommentDto {
  @ApiProperty({ enum: COMMENT_MODERATION_ACTIONS })
  @IsIn(COMMENT_MODERATION_ACTIONS)
  action!: CommentModerationAction;

  @ApiPropertyOptional({
    description:
      'Justificativa. **Obrigatória em `reject`** — tirar do ar o que alguém ' +
      'escreveu exige uma linha dizendo por quê (RN-4). Em `spam`, a própria ' +
      'marcação é o motivo.',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  notes?: string;
}

export class AdminCommentsQueryDto {
  @ApiPropertyOptional({ enum: CommentStatus })
  @IsOptional()
  @IsEnum(CommentStatus)
  status?: CommentStatus;

  @ApiPropertyOptional({ description: 'Só respostas' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  onlyReplies?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}
