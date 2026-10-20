import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ComposerListItemDto } from '../../catalog/composers/dto/composer-list-item.dto';
import { WorkSummaryDto } from '../../catalog/works/dto/work-summary.dto';
import { ArticleSummaryDto } from '../../blog/articles/dto/article-summary.dto';

export class SiteSearchQueryDto {
  @ApiProperty({ minLength: 2, maxLength: 120, example: 'noturno' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  q: string;

  @ApiPropertyOptional({
    description: 'Results per group (composers, works, articles)',
    minimum: 1,
    maximum: 10,
    default: 4,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number = 4;
}

export class SiteSearchResponseDto {
  @ApiProperty() query: string;
  @ApiProperty({ type: [ComposerListItemDto] })
  composers: ComposerListItemDto[];
  @ApiProperty({ type: [WorkSummaryDto] }) works: WorkSummaryDto[];
  @ApiProperty({ type: [ArticleSummaryDto] }) articles: ArticleSummaryDto[];
}
