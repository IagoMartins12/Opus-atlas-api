import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Public } from '../../common/decorators/api-key.decorator';
import {
  AutocompleteQueryDto,
  SearchArticlesQueryDto,
} from './dto/search-articles-query.dto';
import {
  AutocompleteResponseDto,
  SearchArticlesResponseDto,
} from './dto/search-response.dto';
import { SearchService } from './search.service';

@ApiTags('blog-search')
@Public()
@Controller('blog/search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Busca textual em artigos publicados do blog',
    description:
      'Chamadores admin (`role >= 1`) buscam em artigos de qualquer status.',
  })
  @ApiOkResponse({ type: SearchArticlesResponseDto })
  async search(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Query() query: SearchArticlesQueryDto,
  ): Promise<SearchArticlesResponseDto> {
    return this.searchService.searchArticles(
      query,
      user && { sub: user.sub, role: user.role },
    );
  }

  @Get('autocomplete')
  @ApiOperation({
    summary: 'Sugestões de autocomplete (artigos, tags, categorias)',
  })
  @ApiOkResponse({ type: AutocompleteResponseDto })
  async autocomplete(
    @Query() query: AutocompleteQueryDto,
  ): Promise<AutocompleteResponseDto> {
    if (!query.q || query.q.trim().length < 2) {
      return {
        success: true,
        suggestions: { articles: [], tags: [], categories: [] },
      };
    }

    return this.searchService.autocomplete({ q: query.q, type: query.type });
  }
}
