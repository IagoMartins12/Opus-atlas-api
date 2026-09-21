import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ScoreSource } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

// Sem validador, o `forbidNonWhitelisted` do pipe global recusava todo campo
// daqui: favoritar partitura respondia 400 em qualquer chamada.
export class ScoreDataDto {
  @ApiProperty() @IsString() title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() type?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() downloadUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() fileSize?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() pageCount?: string;
}

export class ToggleScoreFavoriteDto {
  @ApiProperty() @IsMongoId() workId: string;

  @ApiProperty({ description: 'ID da partitura na fonte (ex.: IMSLP)' })
  @IsString()
  scoreId: string;

  @ApiPropertyOptional({ enum: ScoreSource, default: ScoreSource.IMSLP })
  @IsOptional()
  @IsEnum(ScoreSource)
  scoreSource?: ScoreSource = ScoreSource.IMSLP;

  @ApiProperty({ enum: ['add', 'remove', 'update'] })
  @IsIn(['add', 'remove', 'update'])
  action: 'add' | 'remove' | 'update';

  @ApiPropertyOptional({
    type: ScoreDataDto,
    description: 'Obrigatório quando `action` é `add`',
  })
  @ValidateIf((dto) => dto.action === 'add')
  @ValidateNested()
  @Type(() => ScoreDataDto)
  scoreData?: ScoreDataDto;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  personalRating?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
