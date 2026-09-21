import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { CreateLessonDto } from './dto/create-lesson.dto';
import {
  CancelLessonDto,
  CompleteLessonDto,
  RescheduleLessonDto,
  StudentFeedbackDto,
  StudentLessonNoticeDto,
} from './dto/lesson-actions.dto';
import { ListLessonsQueryDto } from './dto/list-lessons-query.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';
import { LessonsService } from './lessons.service';

/**
 * Aulas do portal.
 *
 * Um único conjunto de rotas para professor e aluno. O papel de quem chama
 * define o recorte e o que a resposta traz: o professor vê as anotações
 * privadas dele, o aluno não.
 */
@ApiTags('portal-lessons')
@ApiBearerAuth('access-token')
@Controller('lessons')
export class LessonsController {
  constructor(private readonly service: LessonsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Agenda uma aula ou uma série recorrente',
    description:
      'A verificação de conflito cobre todas as ocorrências da série, não apenas ' +
      'a primeira, e considera tanto a agenda do professor quanto a do aluno. ' +
      'Havendo conflito, a resposta 409 traz os choques e sugestões de horário; ' +
      '`force: true` cria mesmo assim.',
  })
  @ApiCreatedResponse({ description: 'Aula (ou série) agendada' })
  @ApiConflictResponse({
    description: 'Conflito de horário, com sugestões de alternativa',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Data no passado ou recorrência incoerente',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Aluno não vinculado, ou convite ainda não aceito',
    type: ErrorResponseDto,
  })
  async create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateLessonDto,
  ) {
    return this.service.create(user.sub, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Lista as aulas do usuário',
    description:
      'Sem `as`, usa o perfil de professor quando existir. As anotações privadas ' +
      'do professor só aparecem para ele.',
  })
  @ApiOkResponse({ description: 'Aulas paginadas' })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  async list(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: ListLessonsQueryDto,
  ) {
    return this.service.list(user.sub, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de uma aula' })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Detalhe da aula' })
  @ApiNotFoundResponse({
    description: 'Aula inexistente, ou de que você não participa',
    type: ErrorResponseDto,
  })
  async findOne(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.service.findOne(user.sub, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edita uma aula agendada',
    description:
      'Só o professor da aula, e só enquanto ela estiver agendada. Para mudar a ' +
      'data, use `reschedule`.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Aula atualizada' })
  @ApiBadRequestResponse({
    description: 'A aula já foi encerrada',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateLessonDto,
  ) {
    return this.service.update(user.sub, id, dto);
  }

  @Patch(':id/reschedule')
  @ApiOperation({
    summary: 'Remarca uma aula',
    description:
      'Guarda o horário anterior e avisa o aluno. Verifica conflito no novo ' +
      'horário, ignorando a própria aula.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Aula remarcada' })
  @ApiConflictResponse({
    description: 'Conflito no novo horário',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async reschedule(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: RescheduleLessonDto,
  ) {
    return this.service.reschedule(user.sub, id, dto);
  }

  @Patch(':id/cancel')
  @ApiOperation({
    summary: 'Cancela uma aula',
    description:
      'Com `cancelSeries`, cancela também as ocorrências futuras da série — as ' +
      'que já aconteceram permanecem, para não reescrever o histórico.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ schema: { example: { cancelled: 4 } } })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async cancel(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CancelLessonDto,
  ) {
    return this.service.cancel(user.sub, id, dto);
  }

  @Patch(':id/complete')
  @ApiOperation({
    summary: 'Registra o resultado da aula',
    description:
      'Ausência do aluno é registrada como falta, não como aula concluída: são ' +
      'coisas diferentes no histórico e nas estatísticas do vínculo.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Aula encerrada' })
  @ApiBadRequestResponse({
    description: 'A aula já foi encerrada',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async complete(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CompleteLessonDto,
  ) {
    return this.service.complete(user.sub, id, dto);
  }

  @Patch(':id/feedback')
  @ApiOperation({
    summary: 'Feedback do aluno sobre a aula',
    description: 'Só o aluno da aula, e só depois de ela ter acontecido.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Feedback registrado' })
  @ApiForbiddenResponse({
    description: 'Apenas o aluno da aula pode dar feedback',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'A aula ainda não aconteceu',
    type: ErrorResponseDto,
  })
  async feedback(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: StudentFeedbackDto,
  ) {
    return this.service.submitStudentFeedback(user.sub, id, dto);
  }

  @Post(':id/student-notice')
  @ApiOperation({
    summary: 'O aluno avisa ausência ou pede para remarcar',
    description:
      'Não altera a aula — quem remarca ou cancela é o professor. Gera a ' +
      'notificação para ele. Só vale enquanto a aula estiver agendada.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Aviso enviado ao professor' })
  @ApiForbiddenResponse({
    description: 'Apenas o aluno da aula pode enviar este aviso',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'A aula não está mais agendada',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async studentNotice(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: StudentLessonNoticeDto,
  ) {
    return this.service.sendStudentNotice(user.sub, id, dto);
  }
}
