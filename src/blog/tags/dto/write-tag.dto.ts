import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsOptional,
  ValidateNested,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SLUG_PATTERN } from '../../articles/article-text';

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Tag em inglês. Campo vazio cai no português. */
export class TagTranslationDto {
  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string | null;

  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  description?: string | null;
}

export class CreateTagDto {
  @ApiProperty({ maxLength: 60 })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ApiPropertyOptional({
    description:
      'Sem ele, o slug sai do nome — pelo mesmo algoritmo que a gravação de artigo usa.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Matches(SLUG_PATTERN, {
    message: 'slug aceita só letras minúsculas, dígitos e hífens simples',
  })
  slug?: string;

  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  description?: string | null;

  @ApiPropertyOptional({ example: '#d4af37' })
  @IsOptional()
  @Matches(HEX_COLOR, { message: 'cor no formato #RRGGBB' })
  color?: string | null;

  @ApiPropertyOptional({
    type: TagTranslationDto,
    description: 'A tag em inglês. `null` apaga.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TagTranslationDto)
  translation?: TagTranslationDto | null;
}

export class UpdateTagDto extends PartialType(CreateTagDto) {}
