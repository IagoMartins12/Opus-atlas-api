import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNoContentResponse,
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
import { AdminCatalogMetricsService } from './admin-catalog-metrics.service';
import { AdminCatalogService } from './admin-catalog.service';
import {
  ListComposersQueryDto,
  ListScoresQueryDto,
  ListWorksQueryDto,
  UpdateComposerDto,
  UpdateScoreDto,
  UpdateWorkDto,
} from './dto/admin-catalog.dto';
import {
  MAX_BULK_VERIFY,
  VerifyComposersBulkDto,
} from './dto/verify-composers-bulk.dto';

/**
 * Curadoria do catálogo.
 *
 * A base tem 19.177 compositores, 207.890 obras e 92.178 partituras, então
 * nenhuma rota aqui carrega coleção inteira: paginação obrigatória, e os
 * filtros por contagem são resolvidos no banco.
 *
 * Toda escrita é auditada. Remover compositor ou obra é destrutivo e passa por
 * verificação de dependências dentro da mesma transação.
 */
@ApiTags('admin-catalog')
@ApiBearerAuth('access-token')
@Roles('SUPER_ADMIN')
@Controller('admin')
export class AdminCatalogController {
  constructor(
    private readonly service: AdminCatalogService,
    private readonly metrics: AdminCatalogMetricsService,
  ) {}

  // --- Compositores ---

  @Get('composers')
  @ApiOperation({ summary: 'Lista compositores' })
  @ApiOkResponse({ description: 'Compositores paginados' })
  async listComposers(@Query() query: ListComposersQueryDto) {
    return this.service.listComposers(query);
  }

  @Patch('composers/:id')
  @Audited({
    action: 'composer.update',
    entityType: 'composer',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Verificação e qualidade de um compositor',
    description:
      'Retirar a verificação limpa `verifiedBy` e `verifiedAt`. No legado esses ' +
      'campos ficavam com o valor antigo, e o registro aparecia não verificado ' +
      'e "verificado por Fulano" ao mesmo tempo.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Compositor atualizado' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async updateComposer(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateComposerDto,
  ) {
    return this.service.updateComposer(user.sub, id, dto);
  }

  @Post('composers/verify-bulk')
  @Audited({ action: 'composer.verifyBulk', entityType: 'composer' })
  @ApiOperation({
    summary: 'Verifica ou desverifica compositores em lote',
    description:
      'A "auditoria" desta operação no legado era um `console.log` de um objeto ' +
      'chamado `auditLog`: mudar o selo de verificação de uma lista arbitrária ' +
      'de compositores não deixava registro consultável nenhum. Agora é uma ' +
      'ação auditada, e a resposta diz quais foram tocados e quais ids não ' +
      `existiam. Máximo de ${MAX_BULK_VERIFY} por chamada.`,
  })
  @ApiOkResponse({
    description: 'Quantos foram atualizados, quais, e os ids inexistentes',
  })
  @ApiNotFoundResponse({
    description: 'Nenhum dos ids informados existe',
    type: ErrorResponseDto,
  })
  async verifyComposersBulk(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: VerifyComposersBulkDto,
  ) {
    return this.service.verifyComposersInBulk(
      user.sub,
      dto.composerIds,
      dto.isVerified,
      dto.notes,
    );
  }

  @Delete('composers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audited({
    action: 'composer.delete',
    entityType: 'composer',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Remove um compositor sem obras',
    description:
      'A contagem de obras e a remoção acontecem na mesma transação — entre uma ' +
      'e outra, uma importação de catálogo podia inserir obras que o cascade ' +
      'levaria junto.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiNoContentResponse({ description: 'Compositor removido' })
  @ApiConflictResponse({
    description: 'Há obras associadas',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async deleteComposer(@Param('id') id: string): Promise<void> {
    return this.service.deleteComposer(id);
  }

  // --- Obras ---

  @Get('works')
  @ApiOperation({
    summary: 'Lista obras',
    description:
      'Os filtros por contagem (`minFavorites`, `minScores`…) são resolvidos no ' +
      'banco com `having`. `coverage.countFilterCapped` avisa quando o critério ' +
      'bateu no teto de candidatos e a lista deixou de ser exaustiva.',
  })
  @ApiOkResponse({ description: 'Obras paginadas' })
  async listWorks(@Query() query: ListWorksQueryDto) {
    return this.service.listWorks(query);
  }

  @Patch('works/:id')
  @Audited({ action: 'work.update', entityType: 'work', entityIdParam: 'id' })
  @ApiOperation({
    summary: 'Edita uma obra',
    description:
      'Sem `dataQuality` nem `verificationNotes`: esses campos não existem em ' +
      '`Work`. O legado os gravava mesmo assim, e por isso verificar uma obra ' +
      'sempre respondia 500.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Obra atualizada' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async updateWork(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateWorkDto,
  ) {
    return this.service.updateWork(user.sub, id, dto);
  }

  @Delete('works/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audited({ action: 'work.delete', entityType: 'work', entityIdParam: 'id' })
  @ApiOperation({
    summary: 'Remove uma obra sem dados de usuário',
    description:
      'A verificação inclui **anotação privada** e partituras. O legado só ' +
      'contava anotação pública, mas o cascade apaga todas — e anotação privada ' +
      'é a que o autor não recupera de lugar nenhum.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiNoContentResponse({ description: 'Obra removida' })
  @ApiConflictResponse({
    description: 'Há dados de usuário associados',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async deleteWork(@Param('id') id: string): Promise<void> {
    return this.service.deleteWork(id);
  }

  // --- Partituras ---

  @Get('scores')
  @ApiOperation({ summary: 'Lista partituras' })
  @ApiOkResponse({ description: 'Partituras paginadas' })
  async listScores(@Query() query: ListScoresQueryDto) {
    return this.service.listScores(query);
  }

  @Patch('scores/:id')
  @Audited({
    action: 'score.update',
    entityType: 'workScore',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Edita uma partitura',
    description: 'Desativar não apaga: o arquivo e o histórico permanecem.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Partitura atualizada' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async updateScore(@Param('id') id: string, @Body() dto: UpdateScoreDto) {
    return this.service.updateScore(id, dto);
  }

  // --- Panorama ---

  @Get('catalog/metrics')
  @ApiOperation({
    summary: 'Panorama do catálogo',
    description:
      'Substitui `admin/content`. Sem cache de processo e sem contagem por ' +
      'época dentro de laço.',
  })
  @ApiOkResponse({ description: 'Totais, cobertura e distribuição' })
  async overview() {
    return this.metrics.overview();
  }

  @Get('catalog/most-annotated')
  @ApiOperation({ summary: 'Obras com mais anotações' })
  @ApiOkResponse({ description: 'Dez obras' })
  async mostAnnotated() {
    return this.metrics.mostAnnotatedWorks();
  }

  @Get('catalog/by-epoch')
  @ApiOperation({ summary: 'Distribuição de obras por época' })
  @ApiOkResponse({ description: 'Épocas com contagem de obras' })
  async byEpoch() {
    return this.metrics.byEpoch();
  }
}
