import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/api-key.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { MediaSearchRequestDto } from './dto/media-search-request.dto';
import { MediaSearchResponseDto } from './dto/media-search-response.dto';
import { MediaSearchService } from './media-search.service';

@ApiTags('media-search')
@Controller('media-search')
export class MediaSearchController {
  constructor(private readonly mediaSearchService: MediaSearchService) {}

  @Public()
  @Post()
  @ApiOperation({
    summary: 'Executa busca automática de mídia para uma obra',
    description:
      'Substitui a rota legada do Next.js responsável por buscar Spotify, YouTube e fontes alternativas de áudio, persistindo os melhores resultados na obra.',
  })
  @ApiOkResponse({
    description: 'Busca de mídia processada com sucesso',
    type: MediaSearchResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Payload inválido',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Obra não encontrada',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit excedido para este IP',
    type: ErrorResponseDto,
  })
  async searchMedia(
    @Body() body: MediaSearchRequestDto,
  ): Promise<MediaSearchResponseDto> {
    return this.mediaSearchService.searchMedia(body);
  }
}
