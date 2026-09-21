import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ComposerWorksQueryDto {
  @ApiPropertyOptional({
    description: 'Página da listagem de obras do compositor',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Quantidade de obras por página',
    example: 50,
    default: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @ApiPropertyOptional({
    description: 'Filtra por instrumento',
    example: '685d591c1e3db0c5aaa893e4',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  instrumentId?: string;

  @ApiPropertyOptional({
    description: 'Filtra por gênero da obra',
    example: 'Sonata',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  workGenresArr?: string;

  @ApiPropertyOptional({
    description: 'Filtra por categoria da obra',
    example: 'Piano Solo',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  categoryNames?: string;

  @ApiPropertyOptional({
    description:
      'Busca textual em título, subtítulo, catálogo, tonalidade e movimento',
    example: 'allegro',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filtra por tipo da obra',
    example: 'INDIVIDUAL',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  workType?: string;

  @ApiPropertyOptional({
    description: 'Filtra por nível de dificuldade',
    example: 'INTERMEDIATE',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  difficultyLevel?: string;
}
