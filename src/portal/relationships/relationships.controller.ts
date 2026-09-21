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
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Public } from '../../common/decorators/api-key.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { InviteStudentDto } from './dto/invite-student.dto';
import { ListStudentsQueryDto } from './dto/list-students-query.dto';
import { UpdateRelationshipDto } from './dto/update-relationship.dto';
import { RelationshipsService } from './relationships.service';

function contextFrom(request: Request) {
  const forwardedFor = request.headers['x-forwarded-for'];

  return {
    ipAddress:
      typeof forwardedFor === 'string' && forwardedFor.length > 0
        ? forwardedFor.split(',')[0].trim()
        : request.ip,
    userAgent: request.headers['user-agent'],
  };
}

/**
 * Vínculo professor-aluno.
 *
 * O convite é o que dá consentimento ao vínculo: o professor não consegue se
 * ligar a alguém sem que a pessoa aceite, e o aluno responde por um link de
 * e-mail — sem precisar estar logado, já que pode nem ter conta ativa ainda.
 */
@ApiTags('portal-relationships')
@Controller()
export class RelationshipsController {
  constructor(private readonly service: RelationshipsService) {}

  // ----------------------------------------------------------------
  // Professor
  // ----------------------------------------------------------------

  @Post('teacher/students')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.CREATED)
  // Convite dispara e-mail para terceiros; sem limite, vira ferramenta de spam.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Convida um aluno',
    description:
      'Cria o vínculo como pendente e envia por e-mail os links de aceite e recusa. ' +
      'O vínculo só passa a valer quando o aluno aceita.',
  })
  @ApiCreatedResponse({ description: 'Convite enviado' })
  @ApiConflictResponse({
    description: 'Já existe vínculo ativo ou convite pendente',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Usuário sem perfil de professor',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto })
  async inviteStudent(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: InviteStudentDto,
    @Req() request: Request,
  ) {
    return this.service.inviteStudent(user.sub, dto, contextFrom(request));
  }

  @Get('teacher/students')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Lista os alunos do professor',
    description:
      'Inclui os convites pendentes, ordenados à frente dos vínculos já aceitos.',
  })
  @ApiOkResponse({ description: 'Alunos paginados' })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  async listStudents(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: ListStudentsQueryDto,
  ) {
    return this.service.listStudents(user.sub, query);
  }

  @Get('teacher/students/search')
  @ApiBearerAuth('access-token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Busca usuários que ainda não são alunos deste professor',
    description:
      'Para o formulário de convite. Devolve apenas nome, e-mail e foto — é uma ' +
      'busca sobre a base inteira de usuários, e qualquer campo a mais viraria ' +
      'exposição de dado de terceiros. Exige ao menos 3 caracteres.',
  })
  @ApiQuery({ name: 'q', example: 'maria' })
  @ApiOkResponse({ description: 'Usuários que podem ser convidados' })
  @ApiBadRequestResponse({
    description: 'Termo de busca curto demais',
    type: ErrorResponseDto,
  })
  async searchInvitable(
    @CurrentUser() user: AccessTokenPayload,
    @Query('q') term: string,
  ) {
    return this.service.searchInvitableUsers(user.sub, term ?? '');
  }

  @Post('teacher/students/:relationshipId/resend-invite')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Reenvia um convite pendente',
    description: 'Emite links novos e invalida os anteriores.',
  })
  @ApiParam({ name: 'relationshipId', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Convite reenviado' })
  @ApiBadRequestResponse({
    description: 'O convite já foi respondido',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async resendInvite(
    @CurrentUser() user: AccessTokenPayload,
    @Param('relationshipId') relationshipId: string,
    @Req() request: Request,
  ) {
    return this.service.resendInvitation(
      user.sub,
      relationshipId,
      contextFrom(request),
    );
  }

  @Patch('teacher/students/:relationshipId')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Atualiza o plano de estudos do vínculo',
    description: 'O aluno do vínculo não pode ser trocado.',
  })
  @ApiParam({ name: 'relationshipId', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Vínculo atualizado' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async updateRelationship(
    @CurrentUser() user: AccessTokenPayload,
    @Param('relationshipId') relationshipId: string,
    @Body() dto: UpdateRelationshipDto,
  ) {
    return this.service.updateRelationship(user.sub, relationshipId, dto);
  }

  @Delete('teacher/students/:relationshipId')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Encerra o vínculo com um aluno',
    description:
      'O registro é encerrado, não apagado: aulas, tarefas e relatórios apontam ' +
      'para ele, e removê-lo levaria junto o histórico das duas partes.',
  })
  @ApiParam({ name: 'relationshipId', example: '685d591c1e3db0c5aaa893e4' })
  @ApiNoContentResponse({ description: 'Vínculo encerrado' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async endRelationship(
    @CurrentUser() user: AccessTokenPayload,
    @Param('relationshipId') relationshipId: string,
    @Body('reason') reason?: string,
  ): Promise<void> {
    await this.service.endRelationship(user.sub, relationshipId, reason);
  }

  // ----------------------------------------------------------------
  // Aluno
  // ----------------------------------------------------------------

  @Get('student/teachers')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Lista os professores com quem o aluno estuda' })
  @ApiOkResponse({ description: 'Professores do aluno' })
  async listTeachers(@CurrentUser() user: AccessTokenPayload) {
    return this.service.listTeachers(user.sub);
  }

  // ----------------------------------------------------------------
  // Resposta ao convite — pública, respondida pelo link do e-mail
  // ----------------------------------------------------------------

  @Public()
  @Post('invites/student/accept/:token')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Aceita um convite de professor',
    description:
      'Pública porque é respondida pelo link do e-mail: quem recebe o convite ' +
      'pode não estar logado, e o próprio token é a credencial. Uso único.',
  })
  @ApiParam({ name: 'token' })
  @ApiOkResponse({ description: 'Convite aceito' })
  @ApiBadRequestResponse({
    description: 'Convite inválido, expirado ou já respondido',
    type: ErrorResponseDto,
  })
  async acceptInvite(@Param('token') token: string) {
    return this.service.acceptInvitation(token);
  }

  @Public()
  @Post('invites/student/decline/:token')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Recusa um convite de professor' })
  @ApiParam({ name: 'token' })
  @ApiOkResponse({ description: 'Convite recusado' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  async declineInvite(@Param('token') token: string) {
    return this.service.declineInvitation(token);
  }
}
