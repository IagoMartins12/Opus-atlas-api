import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Audited } from '../common/audit/audit.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';
import { Roles } from '../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { ScraperDispatchService } from './scraper-dispatch.service';
import { ScraperRegistry, SCRAPER_IDS } from './scraper-registry';
import { SetScraperScheduleDto } from './dto/scrapers.dto';

/**
 * Scraping da programação das casas de espetáculo.
 *
 * **Estas rotas eram abertas.** Todas carregavam `@Public()`, incluindo
 * `POST /scrapers/scrape-all`, que dispara os sete scrapers de uma vez.
 * Qualquer pessoa na internet podia chamá-la em laço: cada chamada abria sete
 * scrapers no processo da API, sem limite de invocações simultâneas, sem
 * autenticação e sem registro de quem pediu. É negação de serviço contra a
 * nossa infraestrutura e contra os sites das casas ao mesmo tempo.
 *
 * Agora exigem papel administrativo, são auditadas, e **respondem 202 com um id
 * de job** — a execução acontece no worker, consultável em
 * `GET /admin/jobs/scraper/:jobId`.
 */
@ApiTags('scrapers')
@ApiBearerAuth('access-token')
@Roles('ADMIN')
@Controller('scrapers')
export class ScrapersController {
  constructor(
    private readonly registry: ScraperRegistry,
    private readonly dispatch: ScraperDispatchService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Casas com scraper disponível',
    description:
      'A lista vem de um provider, não de um mapa montado no construtor do ' +
      'controller — quem precisa dela agora é o worker, que não tem controller.',
  })
  @ApiOkResponse({ description: 'Identificador, nome e endereço de cada casa' })
  list() {
    return { scrapers: this.registry.list() };
  }

  @Post(':scraperId/run')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Audited({
    action: 'scraper.run',
    entityType: 'scraper',
    entityIdParam: 'scraperId',
  })
  @ApiOperation({
    summary: 'Enfileira uma rodada de scraping',
    description:
      'Responde 202 com o id do job. Dois cliques no mesmo minuto devolvem o ' +
      '**mesmo** id — a chave de idempotência inclui o minuto, então não há ' +
      'duas rodadas. A execução roda no worker, fora do processo que atende ' +
      'requisição.',
  })
  @ApiParam({ name: 'scraperId', enum: SCRAPER_IDS })
  @ApiAcceptedResponse({ description: 'Rodada enfileirada' })
  @ApiBadRequestResponse({
    description: 'Scraper desconhecido',
    type: ErrorResponseDto,
  })
  async run(
    @Param('scraperId') scraperId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.dispatch.enqueue(this.registry.requireId(scraperId), user.sub);
  }

  @Post('run-all')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  @Audited({ action: 'scraper.run-all', entityType: 'scraper' })
  @ApiOperation({
    summary: 'Enfileira uma rodada de todas as casas',
    description:
      '**Enfileira, não executa.** O `scrape-all` anterior disparava sete ' +
      '`setImmediate` no processo HTTP, cada um abrindo seu scraper ao mesmo ' +
      'tempo. Aqui os sete entram na fila e o worker os consome um a um: sete ' +
      'navegadores simultâneos estouram a memória do contêiner e fazem o site ' +
      'da casa nos bloquear.',
  })
  @ApiAcceptedResponse({ description: 'Sete jobs enfileirados' })
  async runAll(@CurrentUser() user: AccessTokenPayload) {
    return this.dispatch.enqueueAll(user.sub);
  }

  @Get('schedules')
  @ApiOperation({
    summary: 'Agendamentos de scraping',
    description:
      'Lidos do Redis. Sobrevivem a reinício e valem uma vez para o cluster — ' +
      'com agendamento em memória, N réplicas raspariam a mesma casa N vezes ' +
      'por noite.',
  })
  @ApiOkResponse({ description: 'Agendamentos e próxima execução' })
  async schedules() {
    return this.dispatch.listSchedules();
  }

  @Put('schedules/:scraperId')
  @Audited({
    action: 'scraper.schedule.set',
    entityType: 'scraper',
    entityIdParam: 'scraperId',
  })
  @ApiOperation({ summary: 'Cria ou substitui o agendamento de uma casa' })
  @ApiParam({ name: 'scraperId', enum: SCRAPER_IDS })
  @ApiOkResponse({ description: 'Agendamento salvo, com a próxima execução' })
  @ApiBadRequestResponse({
    description: 'Scraper desconhecido ou cron inválido',
    type: ErrorResponseDto,
  })
  async setSchedule(
    @Param('scraperId') scraperId: string,
    @Body() dto: SetScraperScheduleDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.dispatch.setSchedule({
      scraperId: this.requireScraper(scraperId),
      cron: dto.cron,
      requestedBy: user.sub,
    });
  }

  @Delete('schedules/:scraperId')
  @Audited({
    action: 'scraper.schedule.remove',
    entityType: 'scraper',
    entityIdParam: 'scraperId',
  })
  @ApiOperation({ summary: 'Remove o agendamento de uma casa' })
  @ApiParam({ name: 'scraperId', enum: SCRAPER_IDS })
  @ApiOkResponse({ description: 'Agendamento removido' })
  @ApiNotFoundResponse({
    description: 'Não havia agendamento para esta casa',
    type: ErrorResponseDto,
  })
  async removeSchedule(@Param('scraperId') scraperId: string) {
    const removed = await this.dispatch.removeSchedule(
      this.requireScraper(scraperId),
    );

    if (!removed) {
      throw new NotFoundException('Não há agendamento para esta casa');
    }

    return { scraperId, removed: true };
  }

  private requireScraper(scraperId: string) {
    return this.registry.requireId(scraperId);
  }
}
