import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IMSLPScoreType, ScoreSource } from '@prisma/client';

/** Referência de partitura embutida em `wantToLearn`/`learned` (obra selecionada para estudo). */
export class WorkScoreRefDto {
  @ApiProperty() id: string;
  @ApiProperty() sourceId: string;
  @ApiProperty({ enum: ScoreSource }) source: ScoreSource;
  @ApiProperty() title: string;
  @ApiPropertyOptional({ nullable: true }) downloadUrl?: string | null;
  @ApiPropertyOptional({ nullable: true }) thumbnailUrl?: string | null;
  @ApiPropertyOptional({ nullable: true }) fileSize?: string | null;
  @ApiPropertyOptional({ nullable: true }) pageCount?: string | null;
  @ApiProperty() fileFormat: string;
  @ApiProperty({ enum: IMSLPScoreType }) type: IMSLPScoreType;
  @ApiPropertyOptional({ nullable: true }) editor?: string | null;
  @ApiPropertyOptional({ nullable: true }) publisher?: string | null;
  @ApiPropertyOptional({ nullable: true }) copyright?: string | null;
  @ApiPropertyOptional({ nullable: true }) uploadDate?: string | null;
  @ApiPropertyOptional({ nullable: true }) uploader?: string | null;
  @ApiPropertyOptional({ nullable: true }) notes?: string | null;
}

export const WORK_SCORE_REF_SELECT = {
  id: true,
  sourceId: true,
  source: true,
  title: true,
  downloadUrl: true,
  thumbnailUrl: true,
  fileSize: true,
  pageCount: true,
  fileFormat: true,
  type: true,
  editor: true,
  publisher: true,
  copyright: true,
  uploadDate: true,
  uploader: true,
  notes: true,
} as const;
