import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IMSLPScoreType, ScoreSource } from '@prisma/client';
import { WorkRefDto } from '../../dto/work-ref.dto';

export class ScoreFavoriteDto {
  @ApiProperty() id: string;
  @ApiProperty() userId: string;
  @ApiProperty() workId: string;
  @ApiProperty() scoreId: string;
  @ApiProperty({ enum: ScoreSource }) scoreSource: ScoreSource;
  @ApiProperty() scoreTitle: string;
  @ApiProperty({ enum: IMSLPScoreType }) scoreType: IMSLPScoreType;
  @ApiPropertyOptional({ nullable: true }) personalRating?: number | null;
  @ApiPropertyOptional({ nullable: true }) notes?: string | null;
  @ApiProperty({ type: [String] }) tags: string[];
  @ApiProperty() addedAt: Date;
  @ApiProperty({ type: WorkRefDto }) work: WorkRefDto;
}

export class ScoreFavoriteListResponseDto {
  @ApiProperty({ type: [ScoreFavoriteDto] }) favorites: ScoreFavoriteDto[];
  @ApiProperty() count: number;
}

export class ScoreFavoriteStatusResponseDto {
  @ApiProperty() isFavorited: boolean;
  @ApiProperty({ type: ScoreFavoriteDto, nullable: true })
  favorite: ScoreFavoriteDto | null;
}

export class ScoreFavoriteActionResponseDto {
  @ApiProperty() success: boolean;
  @ApiProperty({ enum: ['added', 'removed', 'updated'] })
  action: 'added' | 'removed' | 'updated';
  @ApiPropertyOptional({ type: ScoreFavoriteDto }) favorite?: ScoreFavoriteDto;
}

export class WorkScoreStatItemDto {
  @ApiProperty() workId: string;
  @ApiProperty() scoreId: string;
  @ApiProperty({ enum: ScoreSource }) scoreSource: ScoreSource;
  @ApiProperty() scoreTitle: string;
  @ApiPropertyOptional({ nullable: true }) scoreType?: string | null;
  @ApiPropertyOptional({ nullable: true }) downloadUrl?: string | null;
  @ApiProperty() totalFavorites: number;
  @ApiPropertyOptional({ nullable: true }) avgRating?: number | null;
}

export class WorkScoreStatsResponseDto {
  @ApiProperty() totalFavorites: number;
  @ApiProperty() totalScores: number;
  @ApiPropertyOptional({ type: WorkScoreStatItemDto, nullable: true })
  mostFavorited: WorkScoreStatItemDto | null;
  @ApiProperty({ type: [WorkScoreStatItemDto] })
  topScores: WorkScoreStatItemDto[];
}
