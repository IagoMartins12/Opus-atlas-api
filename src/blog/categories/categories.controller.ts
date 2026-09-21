import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/api-key.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { ArticleListResponseDto } from '../articles/dto/article-summary.dto';
import { TaxonomyArticlesQueryDto } from '../dto/taxonomy-articles-query.dto';
import { CategoriesService } from './categories.service';
import {
  CategoryListResponseDto,
  CategoryResponseDto,
} from './dto/category.dto';

@ApiTags('blog-categories')
@Public()
@Controller('blog/categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista categorias do blog (com hierarquia pai/filho)',
  })
  @ApiQuery({
    name: 'includeCount',
    required: false,
    description: 'Inclui contagem de artigos publicados',
  })
  @ApiQuery({
    name: 'parentId',
    required: false,
    description: '"null" para categorias de topo, ou o ID de uma categoria pai',
  })
  @ApiOkResponse({ type: CategoryListResponseDto })
  async findAll(
    @Query('includeCount') includeCount?: string,
    @Query('parentId') parentId?: string,
  ): Promise<CategoryListResponseDto> {
    return this.categoriesService.findAll(includeCount === 'true', parentId);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Busca uma categoria pelo slug' })
  @ApiParam({ name: 'slug' })
  @ApiOkResponse({ type: CategoryResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async findBySlug(@Param('slug') slug: string): Promise<CategoryResponseDto> {
    return this.categoriesService.findBySlug(slug);
  }

  @Get(':slug/articles')
  @ApiOperation({
    summary: 'Artigos publicados de uma categoria',
    description:
      'A rota equivalente do legado **nunca funcionou**: ordenava a tabela de junção por `publishedAt` — campo que ela não tem — e o Prisma recusava a consulta; toda chamada voltava 500. Aqui é a mesma listagem de `GET /blog/articles`, filtrada.',
  })
  @ApiParam({ name: 'slug' })
  @ApiOkResponse({ type: ArticleListResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async findArticles(
    @Param('slug') slug: string,
    @Query() query: TaxonomyArticlesQueryDto,
  ): Promise<ArticleListResponseDto> {
    return this.categoriesService.findArticles(slug, query);
  }
}
