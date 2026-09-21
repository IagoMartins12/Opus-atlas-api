import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
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
import { CommentsAdminService } from './comments-admin.service';
import { AdminCommentsQueryDto, ModerateCommentDto } from './dto/comment.dto';

/**
 * Painel de moderação de comentários.
 *
 * O legado moderava em `PATCH /blog/admin/moderation/:id`, mostrava a thread
 * em `GET /blog/comments/:id/thread`, e a página do painel lia os comentários
 * direto do Prisma. Aqui os três moram sob `/blog/admin/comments`.
 */
@ApiTags('blog-comments')
@ApiBearerAuth('access-token')
@Roles('ADMIN')
@Controller('blog/admin/comments')
export class CommentsAdminController {
  constructor(private readonly comments: CommentsAdminService) {}

  @Get()
  @ApiOperation({
    summary: 'Comentários para moderar',
    description:
      'Filtra por estado e por "só respostas". Traz a contagem por estado e, ' +
      'em cada comentário, quantas denúncias estão pendentes na fila.',
  })
  @ApiOkResponse({ description: 'Comentários, contagens e paginação' })
  list(@Query() query: AdminCommentsQueryDto) {
    return this.comments.list(query);
  }

  @Patch(':id')
  @Audited({
    action: 'blog.comment.moderate',
    entityType: 'blog-comment',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Aprova, reprova ou marca como spam',
    description:
      'Registra quem moderou e quando, e fecha as denúncias pendentes do ' +
      'comentário com a mesma decisão. Reprovar exige justificativa (RN-4).',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Comentário moderado' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  moderate(
    @Param('id') id: string,
    @Body() dto: ModerateCommentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.comments.moderate(id, user.sub, dto);
  }

  @Get(':id/thread')
  @ApiOperation({
    summary: 'A conversa inteira de um comentário',
    description: 'A partir do comentário de topo, com todos os estados.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Árvore da conversa' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  thread(@Param('id') id: string) {
    return this.comments.thread(id);
  }
}
