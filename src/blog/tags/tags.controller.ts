import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/api-key.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { ArticleListResponseDto } from '../articles/dto/article-summary.dto';
import { TaxonomyArticlesQueryDto } from '../dto/taxonomy-articles-query.dto';
import { ListTagsQueryDto } from './dto/list-tags-query.dto';
import { TagListResponseDto, TagResponseDto } from './dto/tag.dto';
import { TagsService } from './tags.service';

@ApiTags('blog-tags')
@Public()
@Controller('blog/tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista tags do blog' })
  @ApiOkResponse({ type: TagListResponseDto })
  async findAll(@Query() query: ListTagsQueryDto): Promise<TagListResponseDto> {
    return this.tagsService.findAll(query);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Busca uma tag pelo slug' })
  @ApiParam({ name: 'slug' })
  @ApiOkResponse({ type: TagResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async findBySlug(@Param('slug') slug: string): Promise<TagResponseDto> {
    return this.tagsService.findBySlug(slug);
  }

  @Get(':slug/articles')
  @ApiOperation({
    summary: 'Artigos publicados de uma tag',
    description:
      'A rota equivalente do legado **nunca funcionou**: ordenava a tabela de junção por `publishedAt` — campo que ela não tem — e o Prisma recusava a consulta; toda chamada voltava 500. Aqui é a mesma listagem de `GET /blog/articles`, filtrada pela tag.',
  })
  @ApiParam({ name: 'slug' })
  @ApiOkResponse({ type: ArticleListResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async findArticles(
    @Param('slug') slug: string,
    @Query() query: TaxonomyArticlesQueryDto,
  ): Promise<ArticleListResponseDto> {
    return this.tagsService.findArticles(slug, query);
  }
}
