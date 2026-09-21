import { ApiProperty } from '@nestjs/swagger';
import { WorkCatalogItemDto } from './work-catalog-item.dto';

export class WorksCatalogResponseDto {
  @ApiProperty({ type: [WorkCatalogItemDto] })
  works: WorkCatalogItemDto[];

  @ApiProperty({ example: 18234 })
  totalCount: number;

  @ApiProperty({ example: true })
  hasMore: boolean;
}
