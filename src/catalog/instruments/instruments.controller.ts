import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/api-key.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { InstrumentItemDto } from './dto/instrument-item.dto';
import { InstrumentShowcaseItemDto } from './dto/instrument-showcase.dto';
import { InstrumentStatsResponseDto } from './dto/instrument-stats-response.dto';
import { InstrumentsService } from './instruments.service';

@ApiTags('catalog-instruments')
@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly instrumentsService: InstrumentsService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Lista os instrumentos disponíveis',
    description:
      'Endpoint público e cacheável usado por filtros e formulários do frontend, preservando o contrato básico da rota legada do Next.',
  })
  @ApiOkResponse({
    description: 'Lista de instrumentos retornada com sucesso',
    type: [InstrumentItemDto],
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit excedido para este IP',
    type: ErrorResponseDto,
  })
  async findAll(): Promise<InstrumentItemDto[]> {
    return this.instrumentsService.findAll();
  }

  @Public()
  @Get('showcase')
  @ApiOperation({
    summary: 'Vitrine da página de instrumentos',
    description:
      'Os instrumentos da página, cada um com até 20 obras escolhidas pela curadoria, ' +
      'o total de obras e de alunos e os compositores de destaque. A curadoria mora ' +
      'na API; o texto histórico de cada instrumento é conteúdo estático do frontend.',
  })
  @ApiOkResponse({ type: [InstrumentShowcaseItemDto] })
  async getShowcase(): Promise<InstrumentShowcaseItemDto[]> {
    return this.instrumentsService.getShowcase();
  }

  @Public()
  @Get(':id/stats')
  @ApiOperation({
    summary: 'Estatísticas de um instrumento',
    description:
      'Obras cadastradas, usuários que o estudam e os 5 compositores com mais obras. ' +
      'Usado pela página de história do instrumento — o texto histórico descritivo ' +
      'permanece como conteúdo estático do frontend.',
  })
  @ApiOkResponse({ type: InstrumentStatsResponseDto })
  @ApiNotFoundResponse({
    description: 'Instrumento não encontrado',
    type: ErrorResponseDto,
  })
  async getStats(@Param('id') id: string): Promise<InstrumentStatsResponseDto> {
    return this.instrumentsService.getStats(id);
  }
}
