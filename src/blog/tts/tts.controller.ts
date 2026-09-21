import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Audited } from '../../common/audit/audit.decorator';
import { Public } from '../../common/decorators/api-key.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { DeleteTtsDto, TtsRequestDto } from './tts.dto';
import { MAX_SPEECH_CHARS, TtsService } from './tts.service';

/** O áudio "ouvir o artigo" (Google Text-to-Speech). Mesmo caminho do legado. */
@ApiTags('blog-tts')
@Controller('blog/tts')
export class TtsController {
  constructor(private readonly tts: TtsService) {}

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'O áudio do artigo — o existente, ou um novo',
    description:
      'Quem lê recebe o áudio que já existe. **Gerar ou regerar é da ' +
      `administração**, até ${MAX_SPEECH_CHARS} caracteres, e o texto sai do ` +
      'artigo no servidor — `text` no corpo é ignorado. A rota do legado não ' +
      'tinha autenticação e lia o texto do cliente: qualquer um disparava ' +
      'síntese paga e trocava o áudio de uma matéria pelo que quisesse.',
  })
  @ApiOkResponse({ description: '`audioUrl`, e `cached` diz se já existia' })
  @ApiForbiddenResponse({
    description: 'Sem áudio e sem permissão para gerar',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiServiceUnavailableResponse({
    description: 'Google TTS não configurado ou fora',
    type: ErrorResponseDto,
  })
  audio(
    @Body() dto: TtsRequestDto,
    @CurrentUser() user: AccessTokenPayload | undefined,
  ) {
    return this.tts.audio(dto, user);
  }

  @Delete('google')
  @Roles('ADMIN')
  @ApiBearerAuth('access-token')
  @Audited({ action: 'blog.tts.delete', entityType: 'blog-article' })
  @ApiOperation({
    summary: 'Apaga o áudio do artigo',
    description:
      'Só administração — o legado aceitava qualquer usuário logado. Apaga o ' +
      'arquivo de verdade: o legado errava o identificador no Cloudinary e o ' +
      'arquivo ficava lá.',
  })
  @ApiOkResponse({ description: 'Áudio apagado' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  remove(@Body() dto: DeleteTtsDto) {
    return this.tts.remove(dto.articleId);
  }
}
