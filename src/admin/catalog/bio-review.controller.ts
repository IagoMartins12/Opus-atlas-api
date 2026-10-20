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
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Audited } from '../../common/audit/audit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { BioReviewService } from './bio-review.service';
import { ListBioReviewQueryDto, ReviewBioDto } from './dto/bio-review.dto';

/**
 * Revisão das biografias geradas por IA (e das traduções automáticas): a fila
 * do painel e a aprovação, uma por uma.
 */
@ApiTags('admin-catalog')
@ApiBearerAuth('access-token')
@Roles('ADMIN')
@Controller('admin/bio-review')
export class BioReviewController {
  constructor(private readonly service: BioReviewService) {}

  @Get()
  @ApiOperation({
    summary: 'Biografias à espera de revisão (ou já revisadas)',
    description:
      'Pendente: escrita por IA ou traduzida por máquina e ainda não lida por uma pessoa. Paginação por cursor, em ordem alfabética.',
  })
  @ApiOkResponse({ description: 'Itens, contagens e o próximo cursor' })
  async list(@Query() query: ListBioReviewQueryDto) {
    return this.service.list(query);
  }

  @Post(':id')
  @Audited({
    action: 'composer.bio-review',
    entityType: 'composer',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Aprova a biografia, reescrevendo se for preciso',
    description:
      'Sem corpo, aprova o texto atual (português e tradução). Com `bio` e/ou `bioEn`, grava o texto reescrito, que passa a ser de uma pessoa, e aprova.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'O item, já revisado' })
  @ApiBadRequestResponse({
    description: 'Texto fora de 300–12.000 caracteres ou sem biografia',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async review(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: ReviewBioDto,
  ) {
    return this.service.review(user.sub, id, dto);
  }
}
