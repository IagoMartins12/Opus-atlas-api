import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class VoteAnnotationDto {
  @ApiProperty({ description: 'true = útil, false = não útil' })
  @IsBoolean()
  isHelpful: boolean;
}
