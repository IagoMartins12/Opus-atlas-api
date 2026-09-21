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
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { AssignmentsService } from './assignments.service';
import {
  AssignmentFeedbackDto,
  CompleteAssignmentDto,
  CreateSubmissionDto,
} from './dto/assignment-actions.dto';
import {
  CreateAssignmentDto,
  UpdateAssignmentDto,
  UpdateProgressDto,
} from './dto/create-assignment.dto';
import { ListAssignmentsQueryDto } from './dto/list-assignments-query.dto';

/**
 * Tarefas do portal.
 *
 * Um conjunto de rotas para os dois papéis, como nas aulas. O que separa
 * professor de aluno não é a URL, é o que cada um pode fazer: o professor cria,
 * edita, apaga e dá feedback; o aluno relata progresso, envia material e
 * conclui. Nenhuma rota aceita "atualize estes campos" genérico — cada ação
 * tem seu próprio corpo, com a lista fechada de campos que ela mexe.
 */
@ApiTags('portal-assignments')
@ApiBearerAuth('access-token')
@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly service: AssignmentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Cria uma tarefa a partir de uma aula',
    description:
      'O aluno vem da aula informada; não se envia aluno separadamente. Exige ' +
      'vínculo ativo e aceito com esse aluno.',
  })
  @ApiCreatedResponse({ description: 'Tarefa criada' })
  @ApiBadRequestResponse({
    description: 'Prazo no passado',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Sem perfil de professor, ou aluno não vinculado',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Aula inexistente ou de outro professor',
    type: ErrorResponseDto,
  })
  async create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateAssignmentDto,
  ) {
    return this.service.create(user.sub, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Lista as tarefas do usuário',
    description:
      'As estatísticas cobrem o conjunto inteiro, não a página nem a aba de ' +
      'status aberta. `status=OVERDUE` é derivado do prazo, não um valor guardado.',
  })
  @ApiOkResponse({ description: 'Tarefas paginadas, com estatísticas' })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  async list(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: ListAssignmentsQueryDto,
  ) {
    return this.service.list(user.sub, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Detalhe da tarefa',
    description:
      'Traz as partituras vinculadas e o que o papel de quem chama permite fazer.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Detalhe da tarefa' })
  @ApiNotFoundResponse({
    description: 'Tarefa inexistente, ou de que você não participa',
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
    summary: 'Edita a tarefa',
    description:
      'Só o professor dela. Campos de progresso, conclusão e submissão do aluno ' +
      'não são editáveis por aqui.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Tarefa atualizada' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateAssignmentDto,
  ) {
    return this.service.update(user.sub, id, dto);
  }

  @Patch(':id/feedback')
  @ApiOperation({
    summary: 'Feedback do professor',
    description:
      'Continua disponível depois de encerrado o vínculo, para o professor fechar ' +
      'o que ficou em aberto.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Feedback registrado' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async giveFeedback(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: AssignmentFeedbackDto,
  ) {
    return this.service.giveFeedback(user.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Apaga a tarefa',
    description: 'Remove junto os arquivos enviados pelo aluno nela.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiNoContentResponse({ description: 'Tarefa removida' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async remove(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ): Promise<void> {
    return this.service.remove(user.sub, id);
  }

  @Patch(':id/progress')
  @ApiOperation({
    summary: 'Progresso relatado pelo aluno',
    description:
      'Tira a tarefa de "pendente" sozinho. `milestone` registra um marco no ' +
      'histórico, sem notificar o professor.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Progresso registrado' })
  @ApiBadRequestResponse({
    description: 'A tarefa já foi concluída',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Só o aluno da tarefa pode relatar progresso',
    type: ErrorResponseDto,
  })
  async updateProgress(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateProgressDto,
  ) {
    return this.service.updateProgress(user.sub, id, dto);
  }

  @Post(':id/submissions')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Registra um envio do aluno',
    description:
      'O arquivo sobe antes pelo módulo de uploads e chega aqui como `assetId`. ' +
      'Cada envio entra no histórico em vez de substituir o anterior.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiCreatedResponse({ description: 'Envio registrado' })
  @ApiBadRequestResponse({
    description: 'Tarefa concluída, envio vazio, ou limite de envios atingido',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Só o aluno da tarefa pode enviar',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Arquivo não encontrado, ou de outra pessoa',
    type: ErrorResponseDto,
  })
  async addSubmission(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CreateSubmissionDto,
  ) {
    return this.service.addSubmission(user.sub, id, dto);
  }

  @Delete(':id/submissions/:submissionId')
  @ApiOperation({
    summary: 'Remove um envio',
    description: 'Apaga também o arquivo no armazenamento.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiParam({
    name: 'submissionId',
    example: '0f9c1f1e-9d1a-4c53-8f0e-1c2d3e4f5a6b',
  })
  @ApiOkResponse({ description: 'Envio removido' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async removeSubmission(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Param('submissionId') submissionId: string,
  ) {
    return this.service.removeSubmission(user.sub, id, submissionId);
  }

  @Patch(':id/complete')
  @ApiOperation({
    summary: 'Conclusão pelo aluno',
    description:
      'Grava conclusão, status e data juntos, para as telas não divergirem entre si.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Tarefa concluída' })
  @ApiBadRequestResponse({
    description: 'A tarefa já foi concluída',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Só o aluno da tarefa pode concluir',
    type: ErrorResponseDto,
  })
  async complete(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CompleteAssignmentDto,
  ) {
    return this.service.complete(user.sub, id, dto);
  }
}
