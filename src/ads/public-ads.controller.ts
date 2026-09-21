import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';
import { Public } from '../common/decorators/api-key.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { UploadHistoryService } from '../uploads/shared/upload-history.service';
import { AdEventDto, PublicAdsQueryDto } from './public-ads.dto';
import {
  AdEventResultDto,
  PublicAdsResponseDto,
} from './public-ads-response.dto';
import { deviceOf, PublicAdsService } from './public-ads.service';

/**
 * Anúncios do site — o lado público de `/admin/ads`.
 *
 * Mesmo caminho e mesma resposta do legado (`GET /ads`, `POST /ads`), para o
 * `AdsProvider` e o `useFrontAds` do front trocarem só a base da URL.
 */
@ApiTags('ads')
@Controller('ads')
export class PublicAdsController {
  constructor(private readonly service: PublicAdsService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Anúncio ativo para uma posição',
    description:
      'Um anúncio por combinação de posição e alvo, escolhido entre os que ' +
      'servem para o dispositivo de quem pede (pelo User-Agent).',
  })
  @ApiOkResponse({ type: PublicAdsResponseDto })
  ads(@Query() query: PublicAdsQueryDto, @Req() request: Request) {
    return this.service.ads(query, deviceOf(request.headers['user-agent']));
  }

  @Post()
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Registra impressão, clique ou hover',
    description:
      'Impressão e clique contam uma vez por pessoa por anúncio a cada 30 ' +
      'minutos — o legado somava a cada chamada. `counted` diz se contou.',
  })
  @ApiOkResponse({ type: AdEventResultDto })
  @ApiNotFoundResponse({
    description: 'Anúncio inexistente ou inativo',
    type: ErrorResponseDto,
  })
  track(
    @Body() dto: AdEventDto,
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Req() request: Request,
  ) {
    return this.service.track(dto, {
      userId: user?.sub,
      isTeacher: user?.isTeacher,
      isStudent: user?.isStudent,
      referrer:
        typeof request.headers.referer === 'string'
          ? request.headers.referer
          : undefined,
      ...UploadHistoryService.contextFrom(request),
    });
  }
}
