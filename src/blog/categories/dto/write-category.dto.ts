import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SLUG_PATTERN } from '../../articles/article-text';
import { HEX_COLOR } from '../../tags/dto/write-tag.dto';

export class CreateCategoryDto {
  @ApiProperty({ maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @ApiPropertyOptional({ description: 'Sem ele, o slug sai do nome.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Matches(SLUG_PATTERN, {
    message: 'slug aceita só letras minúsculas, dígitos e hífens simples',
  })
  slug?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string | null;

  // O legado limitava a 2 caracteres, e isso recusava boa parte dos emojis:
  // "🎹" ocupa 2 unidades, mas bandeiras e emojis compostos ocupam de 4 a 11.
  @ApiPropertyOptional({ maxLength: 16, example: '🎹' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  icon?: string | null;

  @ApiPropertyOptional({ example: '#d4af37' })
  @IsOptional()
  @Matches(HEX_COLOR, { message: 'cor no formato #RRGGBB' })
  color?: string | null;

  @ApiPropertyOptional({
    description:
      'Endereço da imagem. Para enviar arquivo, use `POST /blog/admin/categories/:id/image`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  image?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  coverImage?: string | null;

  @ApiPropertyOptional({ description: 'Categoria mãe; `null` para o topo.' })
  @IsOptional()
  @IsMongoId()
  parentId?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  showInMenu?: boolean;

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
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}

export class CategoryOrderDto {
  @ApiProperty()
  @IsMongoId()
  id!: string;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(10_000)
  order!: number;
}

export class ReorderCategoriesDto {
  @ApiProperty({ type: [CategoryOrderDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CategoryOrderDto)
  categories!: CategoryOrderDto[];
}
