import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArticleStatus, ArticleType } from '@prisma/client';
import { AuthorRefDto } from '../../dto/author-ref.dto';
import { CategoryRefDto } from '../../dto/category-ref.dto';
import { TagRefDto } from '../../dto/tag-ref.dto';

export class ArticleStatsDto {
  @ApiProperty() comments: number;
  @ApiProperty() likes: number;
  @ApiPropertyOptional() bookmarks?: number;
}

export class ArticleSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() slug: string;
  @ApiPropertyOptional({ nullable: true }) description?: string | null;
  @ApiPropertyOptional({ nullable: true }) coverImage?: string | null;
  @ApiPropertyOptional({ nullable: true }) coverImageAlt?: string | null;
  @ApiProperty({ enum: ArticleStatus }) status: ArticleStatus;
  @ApiProperty() isFeatured: boolean;
  @ApiPropertyOptional({ nullable: true }) featuredOrder?: number | null;
  @ApiProperty({ enum: ArticleType, isArray: true }) types: ArticleType[];
  @ApiProperty({ type: AuthorRefDto }) author: AuthorRefDto;
  @ApiPropertyOptional({ nullable: true }) publishedAt?: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiPropertyOptional({ nullable: true }) estimatedReadTime?: number | null;
  @ApiProperty() viewCount: number;
  @ApiProperty() readCount: number;
  @ApiProperty({ type: [CategoryRefDto] }) categories: CategoryRefDto[];
  @ApiProperty({ type: [TagRefDto] }) tags: TagRefDto[];
  @ApiProperty({ type: ArticleStatsDto }) stats: ArticleStatsDto;
}

export class ArticlePaginationDto {
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() total: number;
  @ApiProperty() totalPages: number;
}

export class ArticleListResponseDto {
  @ApiProperty() success: boolean;
  @ApiProperty({ type: [ArticleSummaryDto] }) articles: ArticleSummaryDto[];
  @ApiProperty({ type: ArticlePaginationDto }) pagination: ArticlePaginationDto;
}

export class FeaturedArticleDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiPropertyOptional({ nullable: true }) featuredOrder?: number | null;
}

export class FeaturedArticlesResponseDto {
  @ApiProperty() success: boolean;
  @ApiProperty({ type: [FeaturedArticleDto] }) articles: FeaturedArticleDto[];
}
