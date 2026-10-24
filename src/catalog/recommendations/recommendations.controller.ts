import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Public } from '../../common/decorators/api-key.decorator';
import { RecommendationsService } from './recommendations.service';

const clamp = (v: string | undefined, d: number) =>
  Math.min(Math.max(parseInt(v ?? '', 10) || d, 1), 24);

@ApiTags('recommendations')
@Controller()
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get('works/:id/recommendations')
  @ApiOperation({
    summary: 'Peças para estudar depois desta (Plus)',
    description:
      'Do Plus em diante (inclusive o Plus pelo professor): a lista com o motivo de cada uma. ' +
      'Sem o plano, `locked: true` e só a prévia (títulos), para a tela convidar.',
  })
  forWork(
    @Param('id') id: string,
    @Query('limit') limit: string | undefined,
    @Req() req: Request & { user?: { sub?: string } },
  ) {
    return this.recommendations.forWork(id, req.user?.sub, clamp(limit, 8));
  }

  @ApiBearerAuth('access-token')
  @Get('learning/recommendations')
  @ApiOperation({
    summary: 'Recomendadas para você (Plus)',
    description:
      'A partir do que a pessoa já aprendeu, quer aprender e favoritou. Sem o plano, `locked: true`.',
  })
  forMe(
    @CurrentUser() user: AccessTokenPayload,
    @Query('limit') limit: string | undefined,
  ) {
    return this.recommendations.forUser(user.sub, clamp(limit, 12));
  }
}
