import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { AdminPortalService } from './admin-portal.service';
import {
  ListPortalAssignmentsQueryDto,
  ListPortalLessonsQueryDto,
  ListPortalPeopleQueryDto,
  PortalOverviewQueryDto,
} from './dto/admin-portal.dto';

/**
 * O portal de estudo visto do painel: aulas, tarefas, professores e alunos.
 * Só leitura — o painel acompanha, quem mexe é o portal.
 */
@ApiTags('admin-portal')
@ApiBearerAuth('access-token')
@Roles('ADMIN')
@Controller('admin/portal')
export class AdminPortalController {
  constructor(private readonly portal: AdminPortalService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'O portal num relance',
    description:
      'Professores e alunos (e quantos tiveram aula no período), vínculos, ' +
      'aulas por desfecho, aulas que passaram sem desfecho, presença e ' +
      'tarefas em vigor, atrasadas e entregues.',
  })
  @ApiOkResponse({ description: 'Números do período' })
  overview(@Query() q: PortalOverviewQueryDto) {
    return this.portal.overview(q.dias ?? 30);
  }

  @Get('lessons')
  @ApiOperation({ summary: 'Aulas: próximas, passadas ou sem desfecho' })
  @ApiOkResponse({ description: 'Aulas paginadas, com professor e aluno' })
  lessons(@Query() q: ListPortalLessonsQueryDto) {
    return this.portal.lessons(q);
  }

  @Get('lessons/:id')
  @ApiOperation({ summary: 'Uma aula, com tudo o que foi registrado nela' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  lesson(@Param('id') id: string) {
    return this.portal.lesson(id);
  }

  @Get('assignments')
  @ApiOperation({ summary: 'Tarefas: em vigor, atrasadas ou concluídas' })
  @ApiOkResponse({ description: 'Tarefas paginadas, com aluno e professor' })
  assignments(@Query() q: ListPortalAssignmentsQueryDto) {
    return this.portal.assignments(q);
  }

  @Get('assignments/:id')
  @ApiOperation({ summary: 'Uma tarefa' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  assignment(@Param('id') id: string) {
    return this.portal.assignment(id);
  }

  @Get('teachers')
  @ApiOperation({ summary: 'Professores, com alunos ativos e aulas' })
  teachers(@Query() q: ListPortalPeopleQueryDto) {
    return this.portal.teachers(q);
  }

  @Get('students')
  @ApiOperation({ summary: 'Alunos, com professores e tarefas' })
  students(@Query() q: ListPortalPeopleQueryDto) {
    return this.portal.students(q);
  }
}
