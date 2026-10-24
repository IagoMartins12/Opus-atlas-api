import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audited } from '../../common/audit/audit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  ListSupportTicketsQueryDto,
  UpdateSupportTicketDto,
} from './dto/support-tickets.dto';
import { SupportTicketsService } from './support-tickets.service';

@ApiTags('admin-support')
@ApiBearerAuth('access-token')
@Roles('ADMIN')
@Controller('admin/support-tickets')
export class SupportTicketsController {
  constructor(private readonly tickets: SupportTicketsService) {}

  @Get()
  @ApiOperation({
    summary: 'Chamados do formulário de contato',
    description:
      'Abertos: prioritários (planos pagos) primeiro e, dentro de cada grupo, o mais antigo primeiro.',
  })
  list(@Query() query: ListSupportTicketsQueryDto) {
    return this.tickets.list(query);
  }

  @Patch(':id')
  @Audited({
    action: 'support.ticket.update',
    entityType: 'supportTicket',
    entityIdParam: 'id',
  })
  @ApiOperation({ summary: 'Muda a situação do chamado ou a nota interna' })
  update(@Param('id') id: string, @Body() dto: UpdateSupportTicketDto) {
    return this.tickets.update(id, dto);
  }
}
