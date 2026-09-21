import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AdminUploadsListDto,
  AdminUploadStatsDto,
  TopContributorDto,
} from './dto/admin-uploads-response.dto';
import { AdminUploadsService } from './admin-uploads.service';
import {
  ListUploadHistoryQueryDto,
  UploadStatsQueryDto,
} from './dto/admin-uploads.dto';

/**
 * Histórico de contribuições ao catálogo.
 *
 * É a visão administrativa de quem mexeu no quê. **Não se confunde com a fila
 * de moderação**, que já vive em `uploads/moderation` desde a Etapa 1.1 e trata
 * de denúncias a resolver; nem com `AdminAuditLog`, que registra a ação
 * administrativa em si.
 */
@ApiTags('admin-uploads')
@ApiBearerAuth('access-token')
@Roles('SUPER_ADMIN')
@Controller('admin/uploads')
export class AdminUploadsController {
  constructor(private readonly service: AdminUploadsService) {}

  @Get()
  @ApiOperation({
    summary: 'Histórico de contribuições',
    description:
      'As entidades citadas são resolvidas em lote, uma consulta por tipo. ' +
      '`entityExists: false` marca a contribuição sobre algo já removido — o ' +
      'registro permanece, porque é a prova de que a remoção aconteceu.',
  })
  @ApiOkResponse({
    description: 'Contribuições paginadas',
    type: AdminUploadsListDto,
  })
  async list(@Query() query: ListUploadHistoryQueryDto) {
    return this.service.list(query);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Números e linha do tempo',
    description:
      'Uma consulta para a janela inteira, com os dias contados a partir da ' +
      'meia-noite. O legado disparava três contagens por dia — 42 consultas — e ' +
      'usava a hora corrente como limite, o que fazia o dia de hoje aparecer ' +
      'sempre vazio.',
  })
  @ApiOkResponse({
    description: 'Totais e linha do tempo',
    type: AdminUploadStatsDto,
  })
  async stats(@Query() query: UploadStatsQueryDto) {
    return this.service.stats(query);
  }

  @Get('contributors')
  @ApiOperation({ summary: 'Quem mais contribuiu' })
  @ApiOkResponse({
    description: 'Dez maiores contribuidores',
    type: [TopContributorDto],
  })
  async contributors() {
    return this.service.topContributors();
  }
}
