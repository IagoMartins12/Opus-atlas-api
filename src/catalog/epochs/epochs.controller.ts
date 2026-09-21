import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/api-key.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { EpochItemDto } from './dto/epoch-item.dto';
import { EpochComposersGroupDto } from './dto/epoch-composers-group.dto';
import { TimelineComposerItemDto } from './dto/timeline-composer-item.dto';
import { EpochsService } from './epochs.service';

@ApiTags('catalog-epochs')
@Controller('epochs')
export class EpochsController {
  constructor(private readonly epochsService: EpochsService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Lista as épocas musicais disponíveis',
    description:
      'Endpoint público e altamente cacheável usado por filtros e formulários do frontend.',
  })
  @ApiOkResponse({
    description: 'Lista de épocas retornada com sucesso',
    type: [EpochItemDto],
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit excedido para este IP',
    type: ErrorResponseDto,
  })
  async findAll(): Promise<EpochItemDto[]> {
    return this.epochsService.findAll();
  }

  @Public()
  @Get('composers-by-epoch')
  @ApiOperation({
    summary: 'Compositores curados agrupados por época musical',
    description:
      'Até 12 compositores "principais" por época, em ordem cronológica — seção "música ' +
      'por época" da página de Music History. O texto histórico descritivo de cada época ' +
      'permanece como conteúdo estático do frontend.',
  })
  @ApiOkResponse({ type: [EpochComposersGroupDto] })
  async getComposersByEpoch(): Promise<EpochComposersGroupDto[]> {
    return this.epochsService.getComposersByEpoch();
  }

  @Public()
  @Get('timeline')
  @ApiOperation({
    summary: 'Timeline de compositores curados por época',
    description:
      'Mesma curadoria de `composers-by-epoch`, em lista plana com ano de nascimento/morte calculado.',
  })
  @ApiOkResponse({ type: [TimelineComposerItemDto] })
  async getTimeline(): Promise<TimelineComposerItemDto[]> {
    return this.epochsService.getTimeline();
  }
}
