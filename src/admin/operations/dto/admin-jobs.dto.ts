import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListFailuresQueryDto {
  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class ListRecentJobsQueryDto extends ListFailuresQueryDto {
  @ApiPropertyOptional({
    description:
      'Só os jobs com este nome, ou que rodam esta tarefa/casa (`taskId` ou `scraperId` do payload).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  job?: string;
}
