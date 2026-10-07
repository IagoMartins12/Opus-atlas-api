import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/decorators/api-key.decorator';
import { CalendarFeedService } from './calendar-feed.service';
import { CalendarDownloadQueryDto } from './dto/calendar-query.dto';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { CalendarService } from './calendar.service';
import { CalendarQueryDto } from './dto/calendar-query.dto';

/**
 * Calendário do portal.
 *
 * **Só leitura, e uma rota só para os dois papéis.** O legado tinha
 * `student/calendar` e `teacher/calendar` quase idênticos, e cada um trazia
 * junto ações de escrita que já existiam nas rotas de aula — criar, remarcar e
 * comentar — reimplementadas com regras mais fracas. Aqui o calendário monta a
 * visão do período; agendar é `POST /lessons`, remarcar é
 * `PATCH /lessons/:id/reschedule`, e o feedback do aluno é
 * `PATCH /lessons/:id/feedback`.
 */
@ApiTags('portal-calendar')
@ApiBearerAuth('access-token')
@Controller('calendar')
export class CalendarController {
  constructor(
    private readonly service: CalendarService,
    private readonly feeds: CalendarFeedService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Agenda do período, para aluno ou professor',
    description:
      'Reúne aulas e prazos de tarefa numa linha do tempo só. As aulas que já ' +
      'passaram e continuam agendadas vêm à parte, em `needsAttention`, para o ' +
      'professor fechá-las. A resposta não traz cor: devolve `status`, e a ' +
      'paleta é decisão de quem desenha a tela.',
  })
  @ApiOkResponse({
    description:
      'Eventos do período, com metadados e, se pedidos, resumo e conflitos',
  })
  @ApiBadRequestResponse({
    description: 'Datas inválidas, invertidas, ou janela maior que 366 dias',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Sem o perfil pedido em `as`',
    type: ErrorResponseDto,
  })
  async getCalendar(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: CalendarQueryDto,
  ) {
    return this.service.getCalendar(user.sub, query);
  }

  // ----------------------------------------------------------------
  // Para fora do portal (04/10/2026): assinatura e download em .ics
  // ----------------------------------------------------------------

  @Get('feed')
  @ApiOperation({ summary: 'Se a assinatura do calendário está ligada' })
  feedStatus(@CurrentUser() user: AccessTokenPayload) {
    return this.feeds.status(user.sub);
  }

  @Post('feed')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Gera (ou troca) o link de assinatura',
    description:
      'O token só volta aqui, uma vez. Gerar outro derruba o link anterior.',
  })
  rotateFeed(@CurrentUser() user: AccessTokenPayload) {
    return this.feeds.rotate(user.sub);
  }

  @Delete('feed')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Desliga a assinatura (o link para de funcionar)' })
  async revokeFeed(@CurrentUser() user: AccessTokenPayload) {
    await this.feeds.revoke(user.sub);
  }

  @Public()
  @Get('feed/:token')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Cache-Control', 'private, max-age=300')
  @ApiOperation({
    summary: 'O calendário assinado (iCalendar)',
    description:
      'Pública: o Google e a Apple buscam sem login. O token aleatório é a credencial.',
  })
  feed(@Param('token') token: string) {
    return this.feeds.feed(token);
  }

  @Get('ics')
  @ApiOperation({
    summary: 'Baixa as aulas de um período, ou uma aula, em .ics',
  })
  async download(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: CalendarDownloadQueryDto,
    @Res() res: Response,
  ) {
    const body = await this.feeds.download(user.sub, query);
    res
      .status(200)
      .setHeader('Content-Type', 'text/calendar; charset=utf-8')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="${query.lessonId ? 'aula' : 'aulas'}-opus-atlas.ics"`,
      )
      .send(body);
  }
}
