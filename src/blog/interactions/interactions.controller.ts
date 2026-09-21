import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Public } from '../../common/decorators/api-key.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { UploadHistoryService } from '../../uploads/shared/upload-history.service';
import {
  BookmarkArticleDto,
  ReadArticleDto,
  SavedArticlesQueryDto,
} from './dto/interactions.dto';
import { InteractionsService } from './interactions.service';

/**
 * Interações de quem lê com o artigo.
 *
 * Mesmos caminhos do legado: `/blog/interactions/*` e
 * `/blog/articles/:id/view|read`.
 */
@ApiTags('blog-interactions')
@Controller('blog')
export class InteractionsController {
  constructor(private readonly interactions: InteractionsService) {}

  @Get('interactions/articles/:id')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Curtidas e salvamentos do artigo',
    description: 'Com sessão, diz também se o leitor curtiu e salvou.',
  })
  @ApiParam({ name: 'id', description: 'Id do artigo' })
  @ApiOkResponse({ description: 'Contagens e estado do leitor' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  summary(
    @Param('id') articleId: string,
    @CurrentUser() user: AccessTokenPayload | undefined,
  ) {
    return this.interactions.summary(articleId, user?.sub);
  }

  @Post('interactions/articles/:id/like')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Curte o artigo',
    description: 'Idempotente, e só para artigo publicado.',
  })
  @ApiParam({ name: 'id', description: 'Id do artigo' })
  @ApiOkResponse({ description: 'Curtida registrada, com a contagem' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  like(
    @Param('id') articleId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.interactions.like(articleId, user.sub);
  }

  @Delete('interactions/articles/:id/like')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Tira a curtida' })
  @ApiParam({ name: 'id', description: 'Id do artigo' })
  @ApiOkResponse({ description: 'Curtida removida, com a contagem' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  unlike(
    @Param('id') articleId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.interactions.unlike(articleId, user.sub);
  }

  @Post('interactions/articles/:id/bookmark')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Salva o artigo, com nota pessoal opcional',
    description: 'Salvar de novo atualiza a nota. Só artigo publicado.',
  })
  @ApiParam({ name: 'id', description: 'Id do artigo' })
  @ApiOkResponse({ description: 'Artigo salvo' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  bookmark(
    @Param('id') articleId: string,
    @Body() dto: BookmarkArticleDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.interactions.bookmark(articleId, user.sub, dto.notes);
  }

  @Delete('interactions/articles/:id/bookmark')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Tira dos salvos' })
  @ApiParam({ name: 'id', description: 'Id do artigo' })
  @ApiOkResponse({ description: 'Salvamento removido' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  unbookmark(
    @Param('id') articleId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.interactions.unbookmark(articleId, user.sub);
  }

  @Get('interactions/my-likes')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Artigos que curti',
    description: 'Só publicados, sem o conteúdo — é a lista, não a leitura.',
  })
  @ApiOkResponse({ description: 'Curtidas paginadas' })
  myLikes(
    @Query() query: SavedArticlesQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.interactions.myLikes(user.sub, query);
  }

  @Get('interactions/my-bookmarks')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Artigos que salvei',
    description:
      'Só publicados, sem o conteúdo. O legado mostrava também artigo ' +
      'despublicado depois de salvo, com o conteúdo inteiro.',
  })
  @ApiOkResponse({ description: 'Salvos paginados' })
  myBookmarks(
    @Query() query: SavedArticlesQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.interactions.myBookmarks(user.sub, query);
  }

  @Post('articles/:id/view')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Registra uma visita',
    description:
      'Uma por leitor a cada 30 minutos, só em artigo publicado. O legado ' +
      'somava um a cada chamada, sem nenhuma deduplicação. **Nenhuma tela do ' +
      'front atual chama esta rota.**',
  })
  @ApiParam({ name: 'id', description: 'Id do artigo' })
  @ApiOkResponse({ description: '`counted` diz se a visita contou' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  view(
    @Param('id') articleId: string,
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Req() request: Request,
  ) {
    return this.interactions.registerView(articleId, {
      userId: user?.sub,
      ...UploadHistoryService.contextFrom(request),
    });
  }

  @Post('articles/:id/read')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Registra uma leitura completa',
    description:
      'Uma por leitor por dia, só em artigo publicado. O tempo conta até três ' +
      'vezes o estimado do artigo. **Nenhuma tela do front atual chama esta ' +
      'rota** — `readCount` está em zero nos artigos da base.',
  })
  @ApiParam({ name: 'id', description: 'Id do artigo' })
  @ApiOkResponse({ description: '`counted` diz se a leitura contou' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  read(
    @Param('id') articleId: string,
    @Body() dto: ReadArticleDto,
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Req() request: Request,
  ) {
    return this.interactions.registerRead(
      articleId,
      { userId: user?.sub, ...UploadHistoryService.contextFrom(request) },
      dto.readTime,
    );
  }
}
