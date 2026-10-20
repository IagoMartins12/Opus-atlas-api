import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Audited } from '../../common/audit/audit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { AdminContributionsService } from './admin-contributions.service';
import {
  ListAdminContributionsQueryDto,
  RejectContributionDto,
} from './dto/admin-contributions.dto';

/** As contribuições do acervo na moderação do painel: ver e reprovar. */
@ApiTags('admin-contributions')
@ApiBearerAuth('access-token')
@Roles('ADMIN')
@Controller('admin/contributions')
export class AdminContributionsController {
  constructor(private readonly service: AdminContributionsService) {}

  @Get()
  @ApiOperation({
    summary: 'Contribuições em vigor ou reprovadas',
    description:
      'Paginação por cursor, da mais recente para a mais antiga. As contagens respeitam o tipo e o autor filtrados.',
  })
  @ApiOkResponse({ description: 'Itens, contagens e o próximo cursor' })
  async list(@Query() query: ListAdminContributionsQueryDto) {
    return this.service.list(query);
  }

  @Post(':id/reject')
  @Audited({
    action: 'contribution.reject',
    entityType: 'contribution',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Reprova uma contribuição e devolve o XP',
    description:
      'Desfaz o efeito (o valor antigo volta, se nada o substituiu), cancela o XP ou o devolve se já tinha sido pago, e avisa o autor com o motivo.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Id e o XP devolvido' })
  @ApiBadRequestResponse({
    description: 'Motivo curto demais ou contribuição já reprovada',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async reject(@Param('id') id: string, @Body() dto: RejectContributionDto) {
    return this.service.reject(id, dto);
  }
}
