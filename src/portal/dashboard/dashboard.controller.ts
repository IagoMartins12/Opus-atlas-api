import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

/**
 * Painel do portal.
 *
 * Uma rota, dois formatos, distinguidos pelo campo `role` da resposta. O aluno
 * recebe progresso de estudo, professores e prazos; o professor recebe alunos,
 * agenda da semana e o que está esperando resposta dele.
 */
@ApiTags('portal-dashboard')
@ApiBearerAuth('access-token')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get()
  @ApiOperation({
    summary: 'Painel do aluno ou do professor',
    description:
      'O conteúdo é decidido pelo papel. Datas saem como data, não como texto ' +
      'formatado: o fuso e o idioma são de quem exibe, não do servidor.',
  })
  @ApiOkResponse({ description: 'Painel, com `role` indicando o formato' })
  @ApiForbiddenResponse({
    description: 'Sem o perfil pedido em `as`',
    type: ErrorResponseDto,
  })
  async getDashboard(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: DashboardQueryDto,
  ) {
    return this.service.getDashboard(user.sub, query);
  }
}
