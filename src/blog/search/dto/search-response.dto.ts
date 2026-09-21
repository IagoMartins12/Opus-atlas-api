import { ApiProperty } from '@nestjs/swagger';
import {
  ArticlePaginationDto,
  ArticleSummaryDto,
} from '../../articles/dto/article-summary.dto';

export class SearchArticlesResponseDto {
  @ApiProperty() success: boolean;
  @ApiProperty() query: string;
  @ApiProperty({ type: [ArticleSummaryDto] }) results: ArticleSummaryDto[];
  @ApiProperty({ type: ArticlePaginationDto }) pagination: ArticlePaginationDto;
  @ApiProperty({ type: [String] }) suggestions: string[];
}

export class AutocompleteArticleDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() slug: string;
  @ApiProperty({ nullable: true }) coverImage: string | null;
}

/**
 * Formas reduzidas de tag e categoria devolvidas pelo autocomplete.
 *
 * Antes o DTO reaproveitava `TagDto`/`CategoryDto` completos, mas a query do
 * autocomplete projeta só um subconjunto dos campos — o Swagger documentava
 * campos (`createdAt`, `children`, `showInMenu`, `order`, ...) que o endpoint
 * nunca devolve. Estes DTOs descrevem exatamente o que sai na resposta.
 */
export class AutocompleteTagDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
  @ApiProperty({ nullable: true }) color: string | null;
  @ApiProperty() articleCount: number;
}

export class AutocompleteCategoryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
  @ApiProperty({ nullable: true }) icon: string | null;
  @ApiProperty({ nullable: true }) color: string | null;
}

export class AutocompleteSuggestionsDto {
  @ApiProperty({ type: [AutocompleteArticleDto] })
  articles: AutocompleteArticleDto[];
  @ApiProperty({ type: [AutocompleteTagDto] }) tags: AutocompleteTagDto[];
  @ApiProperty({ type: [AutocompleteCategoryDto] })
  categories: AutocompleteCategoryDto[];
}

export class AutocompleteResponseDto {
  @ApiProperty() success: boolean;
  @ApiProperty({ required: false }) query?: string;
  @ApiProperty({ type: AutocompleteSuggestionsDto })
  suggestions: AutocompleteSuggestionsDto;
}
