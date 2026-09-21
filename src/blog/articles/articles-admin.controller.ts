import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Audited } from '../../common/audit/audit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { MAX_FEATURED } from './article-featured';
import { ArticlePublishingService } from './article-publishing.service';
import { ArticleWriterService } from './article-writer.service';
import {
  CreateArticleDto,
  FeatureArticleDto,
  PublishArticleDto,
  ReorderFeaturedDto,
  UpdateArticleDto,
} from './dto/write-article.dto';

/**
 * Escrita de artigos do blog.
 *
 * Mesmo prefixo das rotas públicas de leitura (`blog/articles`), mas outra
 * classe: lá tudo é `@Public()`, e misturar escrita ali deixaria a proteção de
 * cada rota dependendo de ninguém esquecer um decorator.
 *
 * **O contrato muda em dois pontos, os dois para REST.** O legado editava com
 * `PUT /blog/articles` e o id no corpo, e apagava com `DELETE
 * /blog/articles?id=`. Aqui o id vai no caminho: `PATCH /blog/articles/:id` e
 * `DELETE /blog/articles/:id`.
 */
@ApiTags('blog-articles')
@ApiBearerAuth('access-token')
@Roles('ADMIN')
@Controller('blog/articles')
export class ArticlesAdminController {
  constructor(
    private readonly writer: ArticleWriterService,
    private readonly publishing: ArticlePublishingService,
  ) {}

  @Post()
  @Audited({ action: 'blog.article.create', entityType: 'blog-article' })
  @ApiOperation({
    summary: 'Cria um artigo',
    description:
      'Grava artigo, categorias, tags e a versão 1 numa transação só. O ' +
      'conteúdo passa pela política do editor (tipos de bloco fechados, ' +
      'endereços e textos de bloco validados), porque o leitor do blog monta a ' +
      'página com `innerHTML`.',
  })
  @ApiOkResponse({ description: 'Artigo criado' })
  @ApiBadRequestResponse({
    description:
      'Conteúdo recusado (com o caminho do bloco), categoria inexistente, destaque cheio',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Slug já existe',
    type: ErrorResponseDto,
  })
  create(
    @Body() dto: CreateArticleDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.writer.create(dto, user.sub);
  }

  @Post('featured/reorder')
  @HttpCode(HttpStatus.OK)
  @Audited({ action: 'blog.featured.reorder', entityType: 'blog-article' })
  @ApiOperation({
    summary: 'Reordena o carrossel de destaques',
    description: `Só artigos já em destaque, posições de 1 a ${MAX_FEATURED} sem repetição, numa transação.`,
  })
  @ApiOkResponse({ description: 'Ordem gravada' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  reorderFeatured(@Body() dto: ReorderFeaturedDto) {
    return this.publishing.reorderFeatured(dto.articles);
  }

  @Patch(':id')
  @Audited({
    action: 'blog.article.update',
    entityType: 'blog-article',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Edita um artigo',
    description:
      'Grava uma versão nova. Com `expectedVersion`, recusa com 409 se o ' +
      'artigo mudou desde que foi aberto; sem ele, ainda recusa se outra ' +
      'gravação passar no meio desta.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Artigo atualizado' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    description: 'Slug já existe, ou o artigo mudou no meio tempo',
    type: ErrorResponseDto,
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateArticleDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.writer.update(id, dto, user.sub);
  }

  @Delete(':id')
  @Audited({
    action: 'blog.article.delete',
    entityType: 'blog-article',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Apaga um artigo',
    description:
      'Leva junto comentários, curtidas, salvos, mídia e versões, e reconta o ' +
      'uso das tags.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Artigo apagado' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  remove(@Param('id') id: string) {
    return this.writer.remove(id);
  }

  @Patch(':id/publish')
  @Audited({
    action: 'blog.article.publish',
    entityType: 'blog-article',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Publica, despublica ou agenda',
    description:
      'Agendar exige data futura, e o artigo **é de fato publicado** na hora ' +
      'marcada por uma varredura de minuto em minuto — no legado, agendado ' +
      'nunca era publicado. Publicar de novo um artigo já publicado não muda ' +
      'a data dele.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Estado atualizado' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  publish(@Param('id') id: string, @Body() dto: PublishArticleDto) {
    return this.publishing.publish(id, dto.action, dto.scheduledFor);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Audited({
    action: 'blog.article.approve',
    entityType: 'blog-article',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Aprova e publica',
    description:
      'O legado redirecionava o navegador para `/blog/<slug>`; aqui a ' +
      'resposta traz o `slug` e o front navega.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Publicado' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  approve(@Param('id') id: string) {
    return this.publishing.approve(id);
  }

  @Post(':id/duplicate')
  @Audited({
    action: 'blog.article.duplicate',
    entityType: 'blog-article',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Duplica como rascunho',
    description:
      'Slug `-copia`, `-copia-1`…, fora do destaque, com quem duplicou como ' +
      'autor. O conteúdo passa pela política de novo.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Cópia criada' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  duplicate(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.writer.duplicate(id, user.sub);
  }

  @Patch(':id/feature')
  @Audited({
    action: 'blog.article.feature',
    entityType: 'blog-article',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Marca ou desmarca destaque',
    description: `Máximo de ${MAX_FEATURED}. Sem posição, entra na menor livre.`,
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Destaque atualizado' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  feature(@Param('id') id: string, @Body() dto: FeatureArticleDto) {
    return this.publishing.feature(id, dto.isFeatured, dto.featuredOrder);
  }

  @Get(':id/versions')
  @ApiOperation({
    summary: 'Histórico de versões',
    description:
      'O legado gravava versões e não tinha rota para lê-las. Lista sem o ' +
      'conteúdo; o conteúdo vem na rota da versão.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Versões, da mais recente para a mais antiga' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  versions(@Param('id') id: string) {
    return this.writer.listVersions(id);
  }

  @Get(':id/versions/:version')
  @ApiOperation({ summary: 'Uma versão, com o conteúdo' })
  @ApiParam({ name: 'id' })
  @ApiParam({ name: 'version', type: Number })
  @ApiOkResponse({ description: 'Versão com snapshot' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  version(
    @Param('id') id: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.writer.getVersion(id, version);
  }

  @Post(':id/versions/:version/restore')
  @HttpCode(HttpStatus.OK)
  @Audited({
    action: 'blog.article.restore',
    entityType: 'blog-article',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Restaura o texto de uma versão',
    description:
      'Grava como versão nova — nada do histórico é apagado. Restaura texto, ' +
      'capa, vínculos, SEO e música; **não** mexe em estado, slug nem ' +
      'destaque. Versões gravadas pelo legado não guardavam categorias nem ' +
      'tags, e nelas as atuais ficam como estão.',
  })
  @ApiParam({ name: 'id' })
  @ApiParam({ name: 'version', type: Number })
  @ApiOkResponse({ description: 'Artigo restaurado' })
  @ApiBadRequestResponse({
    description: 'A versão tem conteúdo que a política atual recusa',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  restore(
    @Param('id') id: string,
    @Param('version', ParseIntPipe) version: number,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.writer.restore(id, version, user.sub);
  }
}
