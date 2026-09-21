import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WorkScoreItemDto {
  @ApiProperty({ example: '68d6ef3758b5d09465856c02' })
  id: string;

  @ApiProperty({ example: 'IMSLP' })
  source: string;

  @ApiProperty({ example: 'IMSLP12345' })
  sourceId: string;

  @ApiProperty({ example: 'Complete Score' })
  title: string;

  @ApiPropertyOptional({ nullable: true })
  downloadUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  thumbnailUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  fileSize?: string | null;

  @ApiPropertyOptional({ nullable: true })
  pageCount?: string | null;

  @ApiProperty({ example: 'PDF' })
  fileFormat: string;

  @ApiProperty({ example: 'SCORES' })
  type: string;

  @ApiPropertyOptional({ nullable: true })
  groupIndex?: number | null;

  @ApiPropertyOptional({ nullable: true })
  groupTitle?: string | null;

  @ApiPropertyOptional({ nullable: true })
  editor?: string | null;

  @ApiPropertyOptional({ nullable: true })
  publisher?: string | null;
}

export class WorkScoresResponseDto {
  @ApiProperty({ type: [WorkScoreItemDto] })
  scores: WorkScoreItemDto[];

  @ApiProperty({ example: 12 })
  total: number;

  @ApiProperty({ example: true })
  hasMore: boolean;

  @ApiPropertyOptional({
    description:
      'Total de partituras por categoria — só presente quando `limitPerType` é usado',
    example: {
      scores: 3,
      parts: 1,
      arrangements: 0,
      uploads: 0,
      librettos: 0,
      others: 0,
    },
  })
  totalByType?: Record<string, number>;
}
