import { Controller, Get, Query } from '@nestjs/common';
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
  constructor(private readonly service: CalendarService) {}

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
}
