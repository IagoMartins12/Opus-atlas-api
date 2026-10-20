import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

/** The site language the person picked; emails follow it. */
export class UpdateLanguageDto {
  @ApiProperty({ enum: ['pt', 'en'] })
  @IsIn(['pt', 'en'])
  language: 'pt' | 'en';
}
