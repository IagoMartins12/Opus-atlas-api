import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

export class SuggestWorkDto {
  @ApiProperty({ description: 'Obra do acervo.' })
  @IsMongoId()
  workId: string;

  @ApiPropertyOptional({ description: 'Partitura escolhida, quando houver.' })
  @IsOptional()
  @IsMongoId()
  workScoreId?: string;

  @ApiPropertyOptional({
    example: 'Boa para trabalhar o rubato depois do Noturno.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
