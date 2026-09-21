import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/api-key.decorator';
import { DiscoveryResponseDto } from './dto/discovery-response.dto';
import { RecentAdditionsResponseDto } from './dto/recent-additions-response.dto';
import { DiscoveryService } from './discovery.service';

@ApiTags('catalog-discovery')
@Controller('catalog')
export class DiscoveryController {
  constructor(private readonly discoveryService: DiscoveryService) {}

  @Public()
  @Get('discoveries')
  @ApiOperation({
    summary:
      'Compositores e obras menos conhecidos, sorteados a cada ciclo de cache',
    description:
      'Substitui a rota legada `getRandomDiscoveries`, usada na home.',
  })
  @ApiOkResponse({ type: DiscoveryResponseDto })
  async getDiscoveries(): Promise<DiscoveryResponseDto> {
    return this.discoveryService.getDiscoveries();
  }

  @Public()
  @Get('recent')
  @ApiOperation({
    summary: 'Últimos compositores e obras cadastrados no catálogo',
    description: 'Substitui a rota legada `getRecentAdditions`, usada na home.',
  })
  @ApiOkResponse({ type: RecentAdditionsResponseDto })
  async getRecentAdditions(): Promise<RecentAdditionsResponseDto> {
    return this.discoveryService.getRecentAdditions();
  }
}
