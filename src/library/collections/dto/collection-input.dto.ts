import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CollectionKind } from '@prisma/client';
import { queryBoolean } from '../../../common/utils/query-boolean';

export const MAX_ITEMS = 100;

export class CollectionItemInputDto {
  @ApiProperty({ description: 'Id da obra, do compositor ou da partitura.' })
  @IsMongoId()
  refId!: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

class CollectionFieldsDto {
  @ApiProperty({ minLength: 3, maxLength: 80 })
  @IsString()
  @Length(3, 80)
  title!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty()
  @IsBoolean()
  isPublic!: boolean;

  @ApiProperty({ type: [CollectionItemInputDto], maxItems: MAX_ITEMS })
  @ValidateNested({ each: true })
  @Type(() => CollectionItemInputDto)
  @ArrayMaxSize(MAX_ITEMS)
  items!: CollectionItemInputDto[];
}

export class CreateCollectionDto extends CollectionFieldsDto {
  @ApiProperty({ enum: CollectionKind, description: 'Fixo depois de criada.' })
  @IsEnum(CollectionKind)
  kind!: CollectionKind;
}

/** Everything but the kind, which never changes. */
export class UpdateCollectionDto extends CollectionFieldsDto {}

export class FeatureCollectionDto {
  @ApiProperty()
  @IsBoolean()
  featuredOnHome!: boolean;
}

export class ListCollectionsQueryDto {
  @ApiPropertyOptional({ description: 'Só as destacadas na home.' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  featured?: boolean;

  @ApiPropertyOptional({ enum: CollectionKind })
  @IsOptional()
  @IsEnum(CollectionKind)
  kind?: CollectionKind;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 24, maximum: 48 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  limit?: number;
}

export class CandidatesQueryDto {
  @ApiProperty({ enum: CollectionKind })
  @IsEnum(CollectionKind)
  kind!: CollectionKind;

  @ApiPropertyOptional({ minLength: 2, description: 'O que a pessoa digitou.' })
  @IsOptional()
  @IsString()
  @Length(2, 80)
  q?: string;

  @ApiPropertyOptional({
    description: 'Partituras: as desta obra (no lugar de `q`).',
  })
  @IsOptional()
  @IsMongoId()
  workId?: string;

  @ApiPropertyOptional({
    description:
      'Obras: só as deste compositor (filtro opcional; sem `q`, as mais completas dele).',
  })
  @IsOptional()
  @IsMongoId()
  composerId?: string;
}
