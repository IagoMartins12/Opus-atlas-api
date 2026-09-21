import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Public } from '../../common/decorators/api-key.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { ArticlesService } from './articles.service';
import { ArticleDetailResponseDto } from './dto/article-detail.dto';
import { ListArticlesQueryDto } from './dto/list-articles-query.dto';
import {
  ArticleListResponseDto,
  FeaturedArticlesResponseDto,
} from './dto/article-summary.dto';

@ApiTags('blog-articles')
@Public()
@UseGuards(OptionalJwtAuthGuard)
@Controller('blog/articles')
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  @Get()
  @ApiOperation({
    summary:
      'Lista artigos do blog publicados (com filtros, busca e paginação)',
    description:
      'Endpoint público. Anônimos e usuários comuns só veem artigos com status `PUBLISHED` e ' +
      'já dentro da data de publicação. Chamadores com `role >= 1` (admin) podem filtrar por ' +
      'qualquer status.',
  })
  @ApiOkResponse({ type: ArticleListResponseDto })
  async findAll(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Query() query: ListArticlesQueryDto,
  ): Promise<ArticleListResponseDto> {
    return this.articlesService.findAll(
      query,
      user && { sub: user.sub, role: user.role },
    );
  }

  @Get('featured')
  @ApiOperation({
    summary: 'Lista os artigos marcados como destaque (carrossel, máx. 5)',
  })
  @ApiOkResponse({ type: FeaturedArticlesResponseDto })
  async findFeatured(): Promise<FeaturedArticlesResponseDto> {
    return this.articlesService.findFeatured();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Busca o detalhe completo de um artigo',
    description:
      'Aceita o id ou o slug do artigo (o endereço público é o slug). ' +
      'Resolve compositores/obras/partituras/instrumentos/épocas vinculados, artigos ' +
      'relacionados e, quando autenticado, se o chamador curtiu/salvou o artigo.',
  })
  @ApiParam({ name: 'id', description: 'Id ou slug do artigo' })
  @ApiOkResponse({ type: ArticleDetailResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'Artigo não publicado e o chamador não é admin nem autor',
    type: ErrorResponseDto,
  })
  async findOne(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('id') id: string,
  ): Promise<ArticleDetailResponseDto> {
    return this.articlesService.findOne(
      id,
      user && { sub: user.sub, role: user.role },
    );
  }
}
