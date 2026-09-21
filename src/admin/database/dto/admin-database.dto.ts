import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type, plainToInstance } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsMongoId,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { FILTER_OPERATORS, FilterOperator } from '../record-query';

/**
 * Lista separada por vírgula vinda da query.
 *
 * O legado fazia `param.split(',').filter(Boolean)` solto no handler; aqui a
 * conversão fica no DTO, junto da validação.
 */
const toList = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : value;

/**
 * Filtros vindos como JSON na query string.
 *
 * O legado fazia `JSON.parse(searchParams.get('filters'))` **sem `try`**: um
 * JSON malformado virava 500 com `details: error.message`. Aqui o parse falha
 * como 400, e o resultado ainda passa pela validação de cada item.
 *
 * **Os itens saem instanciados como `RecordFilterDto`.** O `@Transform` passa
 * por cima do `@Type`: devolvendo objeto comum, a validação aninhada não
 * reconhecia `field`, `operator` e `value`, e o `forbidNonWhitelisted`
 * recusava todo filtro (até 15/09/2026, nenhum funcionava).
 */
const parseFilters = ({ value }: { value: unknown }): unknown => {
  let parsed: unknown = value;

  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return 'json-invalido';
    }
  }

  return Array.isArray(parsed)
    ? parsed.map((item: unknown) =>
        item && typeof item === 'object'
          ? plainToInstance(RecordFilterDto, item)
          : item,
      )
    : parsed;
};

export class RecordFilterDto {
  @ApiProperty({ example: 'status' })
  @IsString()
  @MaxLength(100)
  field!: string;

  @ApiProperty({ enum: FILTER_OPERATORS })
  @IsIn(FILTER_OPERATORS as unknown as string[])
  operator!: FilterOperator;

  @ApiPropertyOptional({
    description: 'Convertido para o tipo do campo. `in` espera uma lista.',
  })
  @IsOptional()
  value?: unknown;
}

class RecordQueryBaseDto {
  @ApiPropertyOptional({ description: 'Busca livre nos campos de texto.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({
    description:
      'JSON com a lista de filtros, ex.: `[{"field":"status","operator":"eq","value":"ACTIVE"}]`',
  })
  @IsOptional()
  @Transform(parseFilters)
  @IsArray({ message: 'filters precisa ser um JSON de lista' })
  @ValidateNested({ each: true })
  @Type(() => RecordFilterDto)
  filters?: RecordFilterDto[];

  @ApiPropertyOptional({
    description:
      'Campos a devolver, separados por vírgula. Campo protegido é ignorado.',
  })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(100)
  fields?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sortField?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc' = 'desc';
}

export class ListRecordsQueryDto extends RecordQueryBaseDto {
  @ApiProperty({ example: 'NewsletterCampaign' })
  @IsString()
  @MaxLength(100)
  model!: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    default: 25,
    maximum: 200,
    description:
      'Limitado a 200. Sem teto, `pageSize` grande devolvia a coleção inteira ' +
      'numa resposta só.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 25;
}

export class ExportRecordsQueryDto extends RecordQueryBaseDto {
  @ApiProperty({ example: 'Coupon' })
  @IsString()
  @MaxLength(100)
  model!: string;

  @ApiPropertyOptional({ enum: ['json', 'csv'], default: 'json' })
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv' = 'json';
}

export class DescribeModelQueryDto {
  @ApiProperty({ example: 'User' })
  @IsString()
  @MaxLength(100)
  model!: string;
}

export class CreateRecordDto {
  @ApiProperty({ example: 'Epoch' })
  @IsString()
  @MaxLength(100)
  model!: string;

  @ApiProperty({
    description: 'Campos do registro. Protegido, id e datas são recusados.',
    type: Object,
  })
  @IsObject()
  data!: Record<string, unknown>;

  @ApiProperty({
    description: 'Exatamente `CRIAR <Model>`.',
    example: 'CRIAR Epoch',
  })
  @IsString()
  @MaxLength(200)
  confirmation!: string;
}

export class UpdateRecordDto {
  @ApiProperty({
    description: 'Campos a alterar. Protegido, id e datas são recusados.',
    type: Object,
  })
  @IsObject()
  data!: Record<string, unknown>;

  @ApiProperty({
    description: 'Exatamente `ATUALIZAR <Model> <id>`.',
    example: 'ATUALIZAR User 685d591c1e3db0c5aaa893e4',
  })
  @IsString()
  @MaxLength(200)
  confirmation!: string;
}

export class DeleteRecordsDto {
  @ApiProperty({ example: 'Coupon' })
  @IsString()
  @MaxLength(100)
  model!: string;

  @ApiProperty({ type: [String], maxItems: 100 })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsMongoId({ each: true })
  ids!: string[];

  @ApiProperty({
    description:
      'Exatamente `APAGAR <n> <Model>`, com `n` igual ao número de ids. A ' +
      'confirmação de apagar 3 não serve para apagar 300.',
    example: 'APAGAR 3 Coupon',
  })
  @IsString()
  @MaxLength(200)
  confirmation!: string;
}
