import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AnnotationCategory,
  AnnotationDifficulty,
  AnnotationScope,
  DifficultyLevel,
} from '@prisma/client';
import { WorkRefDto } from '../../dto/work-ref.dto';

export class AnnotationAuthorDto {
  @ApiProperty() id: string;
  @ApiPropertyOptional({ nullable: true }) firstName?: string | null;
  @ApiPropertyOptional({ nullable: true }) lastName?: string | null;
  @ApiPropertyOptional({ nullable: true }) username?: string | null;
  @ApiPropertyOptional({ nullable: true }) image?: string | null;
  @ApiPropertyOptional({ nullable: true }) userType?: string | null;
  @ApiPropertyOptional({ nullable: true, enum: DifficultyLevel })
  experienceLevel?: DifficultyLevel | null;
}

export class AnnotationDto {
  @ApiProperty() id: string;
  @ApiProperty() userId: string;
  @ApiProperty() workId: string;
  @ApiProperty() title: string;
  @ApiProperty() content: string;
  @ApiProperty({ enum: AnnotationCategory }) category: AnnotationCategory;
  @ApiProperty({ enum: AnnotationScope }) scope: AnnotationScope;
  @ApiPropertyOptional({ nullable: true }) measureStart?: number | null;
  @ApiPropertyOptional({ nullable: true }) measureEnd?: number | null;
  @ApiPropertyOptional({ nullable: true }) movement?: string | null;
  @ApiPropertyOptional({ nullable: true }) section?: string | null;
  @ApiPropertyOptional({ nullable: true }) pageNumber?: number | null;
  @ApiPropertyOptional({ nullable: true }) hand?: string | null;
  @ApiPropertyOptional({ nullable: true }) voice?: string | null;
  @ApiPropertyOptional({ nullable: true }) instrument?: string | null;
  @ApiProperty({ enum: AnnotationDifficulty }) difficulty: AnnotationDifficulty;
  @ApiProperty({ type: [String] }) tags: string[];
  @ApiProperty() isPublic: boolean;
  @ApiProperty() isVerified: boolean;
  @ApiProperty() helpfulCount: number;
  @ApiProperty() viewCount: number;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiProperty({ type: AnnotationAuthorDto }) user: AnnotationAuthorDto;
  @ApiProperty({ type: WorkRefDto }) work: WorkRefDto;
  @ApiPropertyOptional({
    nullable: true,
    description: 'true = útil, false = não útil, null = sem voto do chamador',
  })
  userVote?: boolean | null;
}

export class AnnotationPaginationDto {
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() total: number;
  @ApiProperty() pages: number;
  @ApiProperty() hasMore: boolean;
}

export class AnnotationListResponseDto {
  @ApiProperty({ type: [AnnotationDto] }) annotations: AnnotationDto[];
  @ApiProperty({ type: AnnotationPaginationDto })
  pagination: AnnotationPaginationDto;
}

export class AnnotationResponseDto {
  @ApiProperty() success: boolean;
  @ApiProperty({ type: AnnotationDto }) annotation: AnnotationDto;
}

export class AnnotationVoteResponseDto {
  @ApiProperty() success: boolean;
  @ApiPropertyOptional({ nullable: true }) userVote: boolean | null;
  @ApiProperty() helpfulCount: number;
}
