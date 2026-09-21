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
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Audited } from '../../common/audit/audit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import {
  AdConflictDto,
  AdminAdDto,
  AdminAdsListDto,
  AdsOverviewDto,
} from './dto/admin-ads-response.dto';
import { AdminAdsService } from './admin-ads.service';
import {
  AttachAdMediaDto,
  CheckAdConflictQueryDto,
  CloneAdDto,
  CreateAdDto,
  ListAdsQueryDto,
  UpdateAdDto,
} from './dto/admin-ads.dto';

/**
 * Anúncios.
 *
 * Exige `ADMIN`, e não `SUPER_ADMIN` como as demais áreas — é o que o legado
 * fazia (`role < 1`), enquanto usuários e catálogo exigiam `role !== 2`. A
 * inconsistência é do original e foi preservada; unificar é decisão de produto,
 * não de migração.
 */
@ApiTags('admin-ads')
@ApiBearerAuth('access-token')
@Roles('ADMIN')
@Controller('admin/ads')
export class AdminAdsController {
  constructor(private readonly service: AdminAdsService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista anúncios com desempenho',
    description:
      'Impressões e cliques vêm de uma agregação. O legado carregava a relação ' +
      '`stats` inteira de cada anúncio — uma linha por dia e dispositivo — para ' +
      'somar dois inteiros em memória.',
  })
  @ApiOkResponse({ description: 'Anúncios paginados', type: AdminAdsListDto })
  async list(@Query() query: ListAdsQueryDto) {
    return this.service.list(query);
  }

  @Get('overview')
  @ApiOperation({ summary: 'Totais por status e desempenho geral' })
  @ApiOkResponse({ description: 'Panorama dos anúncios', type: AdsOverviewDto })
  async overview() {
    return this.service.overview();
  }

  @Get('check-conflict')
  @ApiOperation({
    summary: 'Testa uma combinação antes de salvar',
    description:
      'Cada combinação de tipo, posicionamento, segmentação e instrumento ' +
      'admite um anúncio só. Os defaults do schema são aplicados antes da ' +
      'consulta — sem isso, uma combinação incompleta casava com um anúncio de ' +
      'outro posicionamento.',
  })
  @ApiOkResponse({
    description: 'Se há conflito e qual anúncio o ocupa',
    type: AdConflictDto,
  })
  async checkConflict(@Query() query: CheckAdConflictQueryDto) {
    return this.service.checkConflict(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de um anúncio' })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Anúncio com desempenho', type: AdminAdDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Audited({ action: 'ad.create', entityType: 'advertisement' })
  @ApiOperation({
    summary: 'Cria um anúncio',
    description:
      'A restrição do banco é a autoridade sobre a combinação única: a criação ' +
      'tenta e a violação vira 409 com o anúncio que a ocupa, sem a janela ' +
      'entre checar e escrever.',
  })
  @ApiCreatedResponse({ description: 'Anúncio criado', type: AdminAdDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    description: 'Combinação já ocupada',
    type: ErrorResponseDto,
  })
  async create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateAdDto,
  ) {
    return this.service.create(user.sub, dto);
  }

  @Patch(':id')
  @Audited({
    action: 'ad.update',
    entityType: 'advertisement',
    entityIdParam: 'id',
  })
  @ApiOperation({ summary: 'Edita um anúncio' })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Anúncio atualizado', type: AdminAdDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateAdDto,
  ) {
    return this.service.update(user.sub, id, dto);
  }

  @Post(':id/clone')
  @HttpCode(HttpStatus.CREATED)
  @Audited({
    action: 'ad.clone',
    entityType: 'advertisement',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Duplica um anúncio',
    description:
      'O clone nasce como rascunho e **sem mídia** — dois anúncios apontando ' +
      'para o mesmo arquivo fariam a remoção de um levar a imagem do outro. A ' +
      'verificação de conflito é chamada em processo; o legado fazia `fetch()` ' +
      'para a própria API e pulava a verificação em silêncio quando a ' +
      'autochamada falhava.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiCreatedResponse({ description: 'Clone criado', type: AdminAdDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async clone(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CloneAdDto,
  ) {
    return this.service.clone(user.sub, id, dto);
  }

  @Post(':id/media')
  @Audited({
    action: 'ad.media.attach',
    entityType: 'advertisement',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Anexa mídia ao anúncio',
    description:
      'O arquivo sobe antes pelo módulo de uploads e chega aqui como `assetId`.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Mídia anexada', type: AdminAdDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async attachMedia(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: AttachAdMediaDto,
  ) {
    return this.service.attachMedia(user.sub, id, dto);
  }

  @Delete(':id/media')
  @Audited({
    action: 'ad.media.remove',
    entityType: 'advertisement',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Tira a imagem ou o vídeo do anúncio',
    description: 'Apaga do armazenamento só o arquivo daquele campo.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiQuery({ name: 'kind', enum: ['image', 'video'], required: false })
  @ApiOkResponse({ description: 'Anúncio sem a mídia', type: AdminAdDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async removeMedia(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Query('kind') kind?: string,
  ) {
    return this.service.removeMedia(
      user.sub,
      id,
      kind === 'video' ? 'video' : 'image',
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audited({
    action: 'ad.delete',
    entityType: 'advertisement',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Remove um anúncio',
    description:
      'A mídia sai pelo registro de armazenamento, não por um diretório ' +
      'derivado do título — renomear o anúncio deixava o arquivo órfão.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiNoContentResponse({ description: 'Anúncio removido' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async remove(@Param('id') id: string): Promise<void> {
    return this.service.remove(id);
  }
}
