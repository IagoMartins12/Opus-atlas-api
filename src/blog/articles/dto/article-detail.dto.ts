import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArticleStatus, ArticleType } from '@prisma/client';
import { AuthorRefWithBioDto } from '../../dto/author-ref.dto';
import { CategoryRefDto } from '../../dto/category-ref.dto';
import { TagRefDto } from '../../dto/tag-ref.dto';
import { ArticleStatsDto } from './article-summary.dto';

export class ArticleComposerRefDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) fullName?: string | null;
  @ApiPropertyOptional({ nullable: true }) portraitUrl?: string | null;
  @ApiPropertyOptional({ nullable: true }) epochName?: string | null;
  @ApiPropertyOptional({ nullable: true }) birthDate?: string | null;
  @ApiPropertyOptional({ nullable: true }) deathDate?: string | null;
}

export class ArticleWorkRefDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiPropertyOptional({ nullable: true }) imslpId?: string | null;
  @ApiPropertyOptional({ nullable: true }) opOrCatalog?: string | null;
  @ApiProperty() composer: { id: string; name: string };
  @ApiPropertyOptional({ nullable: true }) instrument?: {
    id: string;
    name: string;
  } | null;
}

export class ArticleScoreRefDto {
  @ApiProperty() id: string;
  @ApiProperty() sourceId: string;
  @ApiProperty() title: string;
  @ApiPropertyOptional({ nullable: true }) downloadUrl?: string | null;
  @ApiProperty() type: string;
  @ApiPropertyOptional({ nullable: true }) thumbnailUrl?: string | null;
  @ApiProperty() work: {
    id: string;
    title: string;
    composer: { id: string; name: string };
  };
}

export class ArticleInstrumentRefDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) category?: string | null;
}

export class ArticleEpochRefDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
}

export class RelatedArticleDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() slug: string;
  @ApiPropertyOptional({ nullable: true }) description?: string | null;
  @ApiPropertyOptional({ nullable: true }) coverImage?: string | null;
  @ApiPropertyOptional({ nullable: true }) publishedAt?: Date | null;
  @ApiPropertyOptional({ nullable: true }) estimatedReadTime?: number | null;
  @ApiProperty() viewCount: number;
}

export class ArticleBackgroundMusicDto {
  @ApiPropertyOptional({ nullable: true }) url?: string | null;
  @ApiPropertyOptional({ nullable: true }) title?: string | null;
  @ApiProperty() volume: number;
  @ApiProperty() loop: boolean;
  @ApiProperty() autoplay: boolean;
}

export class ArticleDetailDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() slug: string;
  @ApiPropertyOptional({ nullable: true }) description?: string | null;
  @ApiProperty({ description: 'Conteúdo rico em blocos (formato livre)' })
  content: unknown;
  @ApiPropertyOptional({ nullable: true }) coverImage?: string | null;
  @ApiPropertyOptional({ nullable: true }) coverImageAlt?: string | null;
  @ApiPropertyOptional({ nullable: true }) coverImageCredit?: string | null;
  @ApiPropertyOptional({ nullable: true }) ttsAudioUrl?: string | null;
  @ApiProperty({ enum: ArticleStatus }) status: ArticleStatus;
  @ApiProperty() isFeatured: boolean;
  @ApiProperty({ enum: ArticleType, isArray: true }) types: ArticleType[];
  @ApiProperty({ type: AuthorRefWithBioDto }) author: AuthorRefWithBioDto;
  @ApiPropertyOptional({ nullable: true }) publishedAt?: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiPropertyOptional({ nullable: true }) readTime?: number | null;
  @ApiPropertyOptional({ nullable: true }) estimatedReadTime?: number | null;
  @ApiProperty() viewCount: number;
  @ApiProperty() readCount: number;
  @ApiProperty({ type: ArticleBackgroundMusicDto })
  backgroundMusic: ArticleBackgroundMusicDto;
  @ApiPropertyOptional({ nullable: true }) metaTitle?: string | null;
  @ApiPropertyOptional({ nullable: true }) metaDescription?: string | null;
  @ApiProperty({ type: [String] }) keywords: string[];
  @ApiProperty({ type: [CategoryRefDto] }) categories: CategoryRefDto[];
  @ApiProperty({ type: [TagRefDto] }) tags: TagRefDto[];
  @ApiProperty({ type: [ArticleComposerRefDto] })
  composers: ArticleComposerRefDto[];
  @ApiProperty({ type: [ArticleWorkRefDto] }) works: ArticleWorkRefDto[];
  @ApiProperty({ type: [ArticleScoreRefDto] }) scores: ArticleScoreRefDto[];
  @ApiProperty({ type: [ArticleInstrumentRefDto] })
  instruments: ArticleInstrumentRefDto[];
  @ApiProperty({ type: [ArticleEpochRefDto] }) epochs: ArticleEpochRefDto[];
  @ApiProperty() userLiked: boolean;
  @ApiProperty() userBookmarked: boolean;
  @ApiProperty({ type: [RelatedArticleDto] })
  relatedArticles: RelatedArticleDto[];
}

export class ArticleDetailResponseDto {
  @ApiProperty() success: boolean;
  @ApiProperty({ type: ArticleDetailDto }) article: ArticleDetailDto;
  @ApiProperty({ type: ArticleStatsDto }) stats: ArticleStatsDto & {
    views: number;
    reads: number;
  };
}
