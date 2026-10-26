import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/api-key.decorator';
import {
  SitemapCatalogEntryDto,
  SitemapCatalogIndexDto,
  SitemapEntriesDto,
} from './sitemap-response.dto';
import { CatalogKind, SeoService } from './seo.service';

@ApiTags('seo')
@Controller('seo')
export class SeoController {
  constructor(private readonly service: SeoService) {}

  @Public()
  @Get('sitemap')
  @ApiOperation({
    summary: 'Dados do sitemap',
    description:
      'Quem entra no sitemap e quando mudou: compositores e obras relevantes, ' +
      'matérias publicadas e professores públicos. O XML é montado pelo Next, ' +
      'dono do domínio e do formato das URLs. Cache de 1 hora.',
  })
  @ApiOkResponse({
    description: 'Entradas do sitemap por tipo',
    type: SitemapEntriesDto,
  })
  sitemap() {
    return this.service.sitemapEntries();
  }

  @Public()
  @Get('sitemap/catalog')
  @ApiOperation({
    summary: 'Índice do sitemap do acervo',
    description:
      'Quantas páginas de sitemap têm os compositores (com obra) e as obras ' +
      'principais, e quantas URLs cabem em cada uma. Cache de 1 dia.',
  })
  @ApiOkResponse({ type: SitemapCatalogIndexDto })
  catalogIndex() {
    return this.service.catalogIndex();
  }

  @Public()
  @Get('sitemap/catalog/:kind/:page')
  @ApiOperation({
    summary: 'Uma página do sitemap do acervo',
    description:
      'Os ids e a data de mudança de uma página de compositores ou de obras, ' +
      'em ordem de id. Cache de 1 dia.',
  })
  @ApiOkResponse({ type: [SitemapCatalogEntryDto] })
  catalogPage(
    @Param('kind') kind: string,
    @Param('page', ParseIntPipe) page: number,
  ) {
    if ((kind !== 'composers' && kind !== 'works') || page < 0 || page > 100)
      throw new BadRequestException('Página de sitemap inválida');
    return this.service.catalogPage(kind as CatalogKind, page);
  }
}
