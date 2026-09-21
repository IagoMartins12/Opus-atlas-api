import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
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
import { Audited } from '../../common/audit/audit.decorator';
import { Public } from '../../common/decorators/api-key.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { UploadHistoryService } from '../../uploads/shared/upload-history.service';
import { CommentsService } from './comments.service';
import {
  CreateCommentDto,
  ListCommentsQueryDto,
  ReportCommentDto,
  UpdateCommentDto,
} from './dto/comment.dto';

/**
 * Comentários do blog.
 *
 * Mesmos caminhos do legado, com a edição por `PATCH` (era `PUT`) e a
 * denúncia exigindo categoria.
 */
@ApiTags('blog-comments')
@Controller('blog/comments')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('article/:id')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Comentários de um artigo publicado, em árvore',
    description:
      'Só comentários no ar; administrador vê todos. Com sessão, cada ' +
      'comentário diz se quem pediu curtiu. O legado mostrava os comentários ' +
      'de rascunho para quem tivesse o id do artigo.',
  })
  @ApiParam({ name: 'id', description: 'Id do artigo' })
  @ApiOkResponse({
    description: 'Comentários de topo, com as respostas dentro',
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  list(
    @Param('id') articleId: string,
    @Query() query: ListCommentsQueryDto,
    @CurrentUser() user: AccessTokenPayload | undefined,
  ) {
    return this.comments.list(
      articleId,
      query.sortBy ?? 'newest',
      user && { sub: user.sub, role: user.role },
    );
  }

  @Post('article/:id')
  @ApiBearerAuth('access-token')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Comenta um artigo publicado',
    description:
      'Texto puro, de 3 a 2.000 caracteres depois de normalizado. Resposta só ' +
      'a comentário do mesmo artigo e que esteja no ar.',
  })
  @ApiParam({ name: 'id', description: 'Id do artigo' })
  @ApiOkResponse({ description: 'Comentário publicado' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  create(
    @Param('id') articleId: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.comments.create(articleId, user.sub, dto);
  }

  @Patch(':id')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Edita o próprio comentário',
    description:
      'Só quem escreveu, e só enquanto o comentário estiver no ar. O legado ' +
      'deixava o administrador reescrever o texto de qualquer pessoa.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Comentário atualizado' })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.comments.update(id, user.sub, dto);
  }

  @Delete(':id')
  @ApiBearerAuth('access-token')
  @Audited({
    action: 'blog.comment.delete',
    entityType: 'blog-comment',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Apaga um comentário',
    description:
      'Quem escreveu, ou administrador. **Com respostas, fica "Comentário ' +
      'removido" no lugar** — o texto é apagado e a conversa de quem ' +
      'respondeu continua (`placeholder: true`). Sem respostas, sai de ' +
      'verdade. O legado apagava a subárvore inteira, levando junto as ' +
      'respostas de outras pessoas.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Apagado, com quantos saíram' })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  remove(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.comments.remove(id, { sub: user.sub, role: user.role });
  }

  @Post(':id/like')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Curte um comentário',
    description:
      'Idempotente: curtir de novo não soma. No legado, cada chamada somava ' +
      'um, e a ordenação "mais curtidos" era manipulável.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Curtida registrada, com a contagem real' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  like(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.comments.like(id, user.sub);
  }

  @Delete(':id/like')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Tira a curtida' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Curtida removida, com a contagem real' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  unlike(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.comments.unlike(id, user.sub);
  }

  @Post(':id/flag')
  @ApiBearerAuth('access-token')
  // Denúncia é gratuita para quem envia e cara para quem revisa.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Denuncia um comentário',
    description:
      'Entra na fila de moderação da plataforma, com prazo pela categoria ' +
      '(RN-4). **O comentário continua no ar** até alguém julgar, salvo ' +
      'categoria grave. No legado, uma denúncia qualquer tirava o comentário ' +
      'do ar na hora.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Denúncia registrada' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    description: 'Você já denunciou este comentário',
    type: ErrorResponseDto,
  })
  report(
    @Param('id') id: string,
    @Body() dto: ReportCommentDto,
    @CurrentUser() user: AccessTokenPayload,
    @Req() request: Request,
  ) {
    return this.comments.report(
      id,
      user.sub,
      dto,
      UploadHistoryService.contextFrom(request),
    );
  }
}
