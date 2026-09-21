import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Audited } from '../../common/audit/audit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ComposerWorksService } from './composer-works.service';
import { ImslpComposerScraper } from './imslp-composer.scraper';
import { ImslpImportService, MAX_IMPORT_BATCH } from './imslp-import.service';
import { ImslpWorkScraper } from './imslp-work.scraper';
import {
  ImportWorksDto,
  ScrapeComposerPageDto,
  ScrapeWorkDto,
} from './dto/imslp.dto';
import {
  DiscoveryResultDto,
  ImportSummaryDto,
  ScrapedImslpComposerDto,
  ScrapedWorkDto,
} from './dto/imslp-response.dto';

/**
 * Leitura de catálogo em fontes externas (IMSLP).
 *
 * **A rota equivalente do legado não tinha autenticação nenhuma.**
 * `POST /uploads/external-sources/scraper` não checava sessão nem papel, e
 * decidia se a URL era confiável com `url.includes('imslp.org')` — um
 * `includes` sobre a URL **inteira**, não sobre o host. Qualquer pessoa na
 * internet podia fazer o servidor buscar um endereço interno
 * (`https://169.254.169.254/latest/meta-data/?x=imslp.org` passava) e receber
 * o conteúdo de volta, já parseado, na resposta. Aqui todas exigem login, são
 * auditadas e limitadas por minuto, e a URL passa por lista fechada de host.
 *
 * **Quem usa (decisão de 15/09):** ler uma página — compositor ou obra — é de
 * quem contribui com o catálogo, como no legado (os modais de envio preenchem
 * a ficha pelo link). Descobrir e importar em lote segue só administrador.
 *
 * **Raspar é só leitura.** Nada grava no catálogo: responde "o que a página
 * diz", e importar é decisão separada, com revisão.
 */
@ApiTags('imslp')
@ApiBearerAuth('access-token')
@Controller('imslp')
export class ImslpController {
  constructor(
    private readonly workScraper: ImslpWorkScraper,
    private readonly composerWorks: ComposerWorksService,
    private readonly importer: ImslpImportService,
    private readonly composerScraper: ImslpComposerScraper,
  ) {}

  @Post('composers/scrape')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Audited({ action: 'imslp.composer.scrape', entityType: 'composer' })
  @ApiOperation({
    summary: 'Lê a ficha de um compositor no IMSLP',
    description:
      'Devolve o que a página do compositor diz, sem gravar nada: nome, nomes ' +
      'alternativos, datas, retrato, nacionalidade, categorias, papéis e a ' +
      'qualidade da página. **A biografia volta nula** — a página de ' +
      'compositor do IMSLP não tem uma; é a Wikipedia que tem. Quando o ' +
      'compositor não é resolvido com certeza no catálogo, vêm os ' +
      '**candidatos** em vez de um palpite.',
  })
  @ApiOkResponse({
    description: 'Ficha do compositor, com o percentual preenchido',
    type: ScrapedImslpComposerDto,
  })
  @ApiBadRequestResponse({
    description: 'URL fora da lista de fontes aceitas',
    type: ErrorResponseDto,
  })
  @ApiBadGatewayResponse({
    description: 'A fonte externa não respondeu como esperado',
    type: ErrorResponseDto,
  })
  async scrapeComposer(@Body() dto: ScrapeComposerPageDto) {
    return this.composerScraper.scrape(dto.url);
  }

  @Post('works/scrape')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Audited({ action: 'imslp.work.scrape', entityType: 'work' })
  @ApiOperation({
    summary: 'Lê uma obra do IMSLP',
    description:
      'Devolve a ficha da obra sem gravar nada. Quando o compositor não é ' +
      'resolvido com certeza, vêm os **candidatos** em vez de um palpite: ' +
      'atribuir a obra ao compositor errado é pior do que deixá-la sem, porque ' +
      'o erro fica invisível no catálogo.',
  })
  @ApiOkResponse({
    description: 'Ficha da obra, com o percentual preenchido',
    type: ScrapedWorkDto,
  })
  @ApiBadRequestResponse({
    description: 'URL fora da lista de fontes aceitas',
    type: ErrorResponseDto,
  })
  @ApiBadGatewayResponse({
    description: 'A fonte externa não respondeu como esperado',
    type: ErrorResponseDto,
  })
  async scrapeWork(@Body() dto: ScrapeWorkDto) {
    return this.workScraper.scrape(dto.url);
  }

  @Get('composers/:id/works')
  @Roles('ADMIN')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Audited({
    action: 'imslp.composer.discover',
    entityType: 'composer',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Descobre as obras de um compositor no IMSLP',
    description:
      'Lista o que a página do compositor anuncia e marca o que já existe no ' +
      'catálogo — **sem visitar nenhuma das obras**. Ler cada página é trabalho ' +
      'da importação, obra a obra.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({
    description: 'Obras encontradas e quais já foram importadas',
    type: DiscoveryResultDto,
  })
  @ApiNotFoundResponse({
    description: 'Compositor inexistente, ou sem página do IMSLP registrada',
    type: ErrorResponseDto,
  })
  async discoverWorks(@Param('id') composerId: string) {
    return this.composerWorks.discover(composerId);
  }

  @Post('composers/:id/works/import')
  @Roles('ADMIN')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Audited({
    action: 'imslp.works.import',
    entityType: 'composer',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Importa obras do IMSLP para o catálogo',
    description:
      'Lê cada obra e a grava. **A importação em lote do legado não podia ter ' +
      'funcionado**: para raspar, ela fazia o servidor chamar a própria API por ' +
      'HTTP sem cookie nenhum, e a rota chamada exige sessão — toda obra ' +
      'voltava 401 e era registrada como erro, enquanto a resposta dizia ' +
      '`success: true`. Aqui o scraper é chamado como serviço, no mesmo ' +
      `processo. Máximo de ${MAX_IMPORT_BATCH} obras por chamada, uma de cada ` +
      'vez para não ser bloqueado pelo IMSLP.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({
    description: 'Resultado obra a obra: importada, duplicada ou com erro',
    type: ImportSummaryDto,
  })
  @ApiBadRequestResponse({
    description: 'Lote fora do limite, ou compositor sem época definida',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Compositor não encontrado',
    type: ErrorResponseDto,
  })
  async importWorks(
    @Param('id') composerId: string,
    @Body() dto: ImportWorksDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.importer.importWorks({
      composerId,
      urls: dto.urls,
      userId: user.sub,
    });
  }
}
