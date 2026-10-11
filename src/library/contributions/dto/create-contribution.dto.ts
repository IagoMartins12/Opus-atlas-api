import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type { ContributableEntity } from '../contribution-rules';

export class CreateContributionDto {
  @ApiProperty({ enum: ['composer', 'work'] })
  @IsIn(['composer', 'work'])
  entityType!: ContributableEntity;

  @ApiProperty()
  @IsMongoId()
  entityId!: string;

  @ApiProperty({
    description:
      'Campo alterado: composer (bio, bioEn, videoUrl, birthDate, deathDate, ' +
      'nationality, wikipediaLink) ou work (compositionYear, firstPublishDate, ' +
      'tone, dedicateTo, instrumentation, subtitle).',
  })
  @IsString()
  @MaxLength(40)
  field!: string;

  @ApiProperty({ description: 'O novo valor.' })
  @IsString()
  @MaxLength(12_000)
  value!: string;

  @ApiPropertyOptional({ description: 'Fonte: um link ou um livro.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  source?: string;
}

export class CreateCuriosityDto {
  @ApiProperty({ minLength: 20, maxLength: 280 })
  @IsString()
  @MaxLength(280)
  text!: string;

  @ApiProperty({ enum: ['pt', 'en'] })
  @IsIn(['pt', 'en'])
  language!: 'pt' | 'en';

  @ApiPropertyOptional({ description: 'Onde a pessoa leu isso.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  source?: string;
}
