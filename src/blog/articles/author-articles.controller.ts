import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Audited } from '../../common/audit/audit.decorator';
import { Curator } from '../../common/auth/curator.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { AuthorArticlesService } from './author-articles.service';
import { CreateArticleDto, UpdateArticleDto } from './dto/write-article.dto';

/**
 * "Meus artigos": quem escreve (administrador ou professor aprovado) lista,
 * cria e edita os próprios. Prefixo próprio para não cair em
 * `blog/articles/:id`, a leitura pública.
 */
@ApiTags('blog-articles')
@ApiBearerAuth('access-token')
@Roles('USER')
@Curator()
@Controller('blog/my-articles')
export class AuthorArticlesController {
  constructor(private readonly authors: AuthorArticlesService) {}

  @Get()
  @ApiOperation({ summary: 'Os artigos de quem pede, em qualquer estado' })
  @ApiOkResponse({ description: 'Lista' })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  list(@CurrentUser() user: AccessTokenPayload) {
    return this.authors.listMine(user.sub);
  }

  @Post()
  @Audited({ action: 'blog.article.create', entityType: 'blog-article' })
  @ApiOperation({
    summary: 'Cria um artigo próprio',
    description:
      'Rascunho ou revisão; publicar vira revisão. Sem destaque e sem agendamento.',
  })
  @ApiOkResponse({ description: 'Artigo criado' })
  create(
    @Body() dto: CreateArticleDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.authors.create(dto, user.sub);
  }

  @Patch(':id')
  @Audited({
    action: 'blog.article.update',
    entityType: 'blog-article',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Edita um artigo próprio',
    description: 'Só enquanto rascunho ou em revisão.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Artigo atualizado' })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateArticleDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.authors.update(id, dto, user.sub);
  }
}
