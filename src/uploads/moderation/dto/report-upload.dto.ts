import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  REPORT_CATEGORIES,
  REPORT_CATEGORY_IDS,
  ReportCategory,
} from '../report-categories';

/**
 * O que pode ser denunciado.
 *
 * `blog-comment` entra na mesma fila, e não numa fila do blog: a regra de
 * moderação (RN-4) nomeia os comentários, e uma segunda fila teria de repetir
 * categoria, prioridade, prazo, deduplicação por denunciante e a varredura que
 * avisa sobre prazo estourado — ou, mais provável, ficaria sem eles.
 */
export const REPORTABLE_ENTITIES = [
  'composer',
  'work',
  'score',
  'blog-comment',
] as const;
export type ReportableEntity = (typeof REPORTABLE_ENTITIES)[number];

export class ReportUploadDto {
  @ApiProperty({ enum: REPORTABLE_ENTITIES, example: 'work' })
  @IsIn(REPORTABLE_ENTITIES)
  entityType: ReportableEntity;

  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  @IsMongoId()
  entityId: string;

  @ApiProperty({
    enum: REPORT_CATEGORY_IDS,
    example: 'copyright',
    description:
      'Categoria da denúncia. **Ela determina a prioridade e o prazo de ' +
      'análise** — quem denuncia não escolhe a urgência. As categorias: ' +
      REPORT_CATEGORY_IDS.map(
        (id) => `\`${id}\` (${REPORT_CATEGORIES[id as ReportCategory].label})`,
      ).join(', ') +
      '.',
  })
  @IsIn(REPORT_CATEGORY_IDS)
  category: ReportCategory;

  @ApiProperty({
    example: 'A partitura é uma edição de 1998, ainda protegida.',
    description: 'O que quem denuncia viu. Texto livre.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason: string;

  @ApiPropertyOptional({ description: 'Detalhamento do problema.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
