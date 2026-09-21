import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class ListTeachersQueryDto {
  @ApiPropertyOptional({ description: 'Filtra por instrumento ensinado' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  instrument?: string;

  @ApiPropertyOptional({ description: 'Filtra por especialidade' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  specialty?: string;

  @ApiPropertyOptional({
    description: 'Filtra por nível de habilidade ensinado',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  skillLevel?: string;

  @ApiPropertyOptional({ description: 'Filtra por faixa etária atendida' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  ageGroup?: string;

  @ApiPropertyOptional({
    description: 'Filtra por cidade ou estado (contains)',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  location?: string;

  @ApiPropertyOptional({ description: 'Mostra só professores verificados' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  verified?: boolean;

  @ApiPropertyOptional({
    enum: ['rating', 'students', 'experience', 'name'],
    default: 'rating',
  })
  @IsOptional()
  @IsIn(['rating', 'students', 'experience', 'name'])
  sortBy?: 'rating' | 'students' | 'experience' | 'name' = 'rating';

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 12, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 12;
}
