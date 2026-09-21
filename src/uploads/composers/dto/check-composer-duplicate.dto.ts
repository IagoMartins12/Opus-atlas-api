import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CheckComposerDuplicateDto {
  @ApiProperty({
    example: 'https://imslp.org/wiki/Category:Mozart,_Wolfgang_Amadeus',
    description: 'Link de origem do compositor.',
  })
  @IsString()
  @MaxLength(1000)
  url: string;

  @ApiProperty({ enum: ['imslp', 'wikipedia'], example: 'imslp' })
  @IsIn(['imslp', 'wikipedia'])
  source: 'imslp' | 'wikipedia';

  @ApiPropertyOptional({
    example: 'Wolfgang Amadeus Mozart',
    description: 'Nome completo, usado na checagem por grafia alternativa.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fullName?: string;

  @ApiPropertyOptional({
    description: 'Compositor sendo editado, excluído da checagem.',
  })
  @IsOptional()
  @IsMongoId()
  excludeId?: string;
}
