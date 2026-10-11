import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsString, MaxLength } from 'class-validator';
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
}

export class CreateCuriosityDto {
  @ApiProperty({ minLength: 20, maxLength: 400 })
  @IsString()
  @MaxLength(400)
  text!: string;

  @ApiProperty({ enum: ['pt', 'en'] })
  @IsIn(['pt', 'en'])
  language!: 'pt' | 'en';
}
