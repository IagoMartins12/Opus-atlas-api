import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { BioLanguage } from '../composer-bio.service';

export class BiographyRequestDto {
  @ApiPropertyOptional({ enum: ['pt', 'en'], default: 'pt' })
  @IsOptional()
  @IsIn(['pt', 'en'])
  language?: BioLanguage;
}
