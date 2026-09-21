import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { MarkShownDto } from './dto/mark-shown.dto';
import { NotificationListResponseDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

/**
 * Caixa de entrada do usuário.
 *
 * Um único conjunto de rotas para aluno e professor. O legado tinha dois,
 * praticamente idênticos, diferindo só no papel exigido — o que dava duas
 * caixas de entrada separadas para quem é professor e aluno ao mesmo tempo,
 * apesar de as notificações pertencerem ao mesmo `userId`.
 */
@ApiTags('portal-notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista as notificações do usuário',
    description:
      'Por padrão devolve só as vigentes — sem prazo, ou com prazo no futuro. ' +
      'Ordenadas por prioridade e depois por data.',
  })
  @ApiOkResponse({ type: NotificationListResponseDto })
  async list(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.service.list(user.sub, query);
  }

  @Get('unread-count')
  @ApiOperation({
    summary: 'Quantidade de notificações não lidas',
    description: 'Consulta leve, para o contador do cabeçalho.',
  })
  @ApiOkResponse({ schema: { example: { unreadCount: 3 } } })
  async unreadCount(@CurrentUser() user: AccessTokenPayload) {
    return { unreadCount: await this.service.unreadCount(user.sub) };
  }

  @Get('pending')
  @ApiOperation({
    summary: 'Notificações que ainda não foram exibidas',
    description:
      'O front pede o que falta mostrar, exibe, e confirma com `shown` — assim ' +
      'o mesmo aviso não reaparece a cada navegação.',
  })
  @ApiQuery({ name: 'channel', enum: ['toast', 'browser'], required: false })
  @ApiOkResponse({ description: 'Notificações pendentes de exibição' })
  async pending(
    @CurrentUser() user: AccessTokenPayload,
    @Query('channel') channel?: 'toast' | 'browser',
  ) {
    return {
      notifications: await this.service.pendingToShow(
        user.sub,
        channel === 'browser' ? 'browser' : 'toast',
      ),
    };
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Marca uma notificação como lida' })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiNoContentResponse({ description: 'Notificação marcada como lida' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async markAsRead(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.markAsRead(user.sub, id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Marca todas as notificações como lidas' })
  @ApiOkResponse({ schema: { example: { updated: 7 } } })
  async markAllAsRead(@CurrentUser() user: AccessTokenPayload) {
    return { updated: await this.service.markAllAsRead(user.sub) };
  }

  @Patch(':id/shown')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Registra que a notificação foi exibida',
    description: 'Impede que o mesmo aviso reapareça no próximo carregamento.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiNoContentResponse({ description: 'Exibição registrada' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async markAsShown(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: MarkShownDto,
  ): Promise<void> {
    await this.service.markAsShown(user.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Descarta uma notificação',
    description: 'A notificação sai da caixa de entrada sem ser apagada.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiNoContentResponse({ description: 'Notificação descartada' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async dismiss(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.dismiss(user.sub, id);
  }
}
