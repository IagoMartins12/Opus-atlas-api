import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Audited } from '../../common/audit/audit.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { ScrapeComposerDto } from './dto/wikipedia.dto';
import { WikipediaComposerScraper } from './wikipedia-composer.scraper';
import { ScrapedComposerDto } from './dto/wikipedia-response.dto';

/**
 * Leitura de compositor na Wikipedia.
 *
 * **A rota equivalente do legado não tinha autenticação nenhuma.**
 * `POST /uploads/external-sources/scraper` não checava sessão nem papel, e
 * decidia se a URL era confiável com `url.includes('wikipedia.org')` — sobre a
 * URL inteira, não sobre o host. Esta exige login, é auditada e limitada por
 * minuto, e o endereço passa pela mesma lista fechada do catálogo do IMSLP.
 * Aberta a quem contribui com o catálogo (decisão de 15/09), como no legado.
 *
 * **É só de leitura.** Nada aqui grava no catálogo.
 */
@ApiTags('wikipedia')
@ApiBearerAuth('access-token')
@Controller('wikipedia')
export class WikipediaController {
  constructor(private readonly scraper: WikipediaComposerScraper) {}

  @Post('composers/scrape')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Audited({ action: 'wikipedia.composer.scrape', entityType: 'composer' })
  @ApiOperation({
    summary: 'Lê a ficha de um compositor na Wikipedia',
    description:
      'Devolve o que a Wikipedia e o Wikidata dizem, sem gravar nada. ' +
      '**As datas vêm do Wikidata, não da prosa do artigo**: de lá elas vêm ' +
      'com a precisão declarada (dia, mês ou só o ano) e com o calendário — o ' +
      'nascimento de Bach é 21 de março de 1685 no juliano e 31 de março no ' +
      'gregoriano, e ler da prosa é ficar com a que o autor do artigo ' +
      'escolheu. Quando o compositor não é resolvido com certeza no catálogo, ' +
      'vêm os **candidatos** em vez de um palpite.',
  })
  @ApiOkResponse({
    description: 'Ficha do compositor, com o percentual preenchido',
    type: ScrapedComposerDto,
  })
  @ApiBadRequestResponse({
    description: 'URL fora da lista de fontes aceitas',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'A Wikipedia não tem o artigo',
    type: ErrorResponseDto,
  })
  @ApiBadGatewayResponse({
    description: 'A fonte externa não respondeu como esperado',
    type: ErrorResponseDto,
  })
  async scrapeComposer(@Body() dto: ScrapeComposerDto) {
    return this.scraper.scrape(dto.url);
  }
}
