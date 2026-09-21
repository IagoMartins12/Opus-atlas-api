import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/api-key.decorator';
import { SitemapEntriesDto } from './sitemap-response.dto';
import { SeoService } from './seo.service';

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
}
