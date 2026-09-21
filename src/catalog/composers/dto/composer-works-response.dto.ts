import { ApiProperty } from '@nestjs/swagger';
import { ComposerWorkItemDto } from './composer-work-item.dto';

export class ComposerWorksResponseDto {
  @ApiProperty({ type: [ComposerWorkItemDto] })
  works: ComposerWorkItemDto[];

  @ApiProperty({ example: 87 })
  totalCount: number;

  @ApiProperty({ example: true })
  hasMore: boolean;

  @ApiProperty({ example: 1 })
  currentPage: number;
}
