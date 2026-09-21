import { Injectable, Logger } from '@nestjs/common';
import { ImportService } from './import/import.service';
import { ScraperId, ScraperRegistry } from './scraper-registry';

export interface ScraperRunResult {
  scraperId: ScraperId;
  venueName: string;
  /** Quantos eventos a página listava. */
  eventsFound: number;
  /** Gravados como `Event` novos. */
  imported: number;
  /** Já existiam — mesmo `externalId`, ou mesmo título na mesma data. */
  duplicates: number;
  /** Encontrados e não gravados (ex.: sem horário de início). */
  failed: number;
  durationMs: number;
  /** Motivos dos que não entraram, para conferência. */
  problems: string[];
}

/** Quantos motivos de falha voltam no resultado do job. */
const MAX_PROBLEMS = 20;

/**
 * Uma rodada completa de scraping de uma casa.
 *
 * **O pipeline não tinha fim.** O controller chamava
 * `scraper.scrapeAndCheckDuplicates()`, guardava a resposta num `Map` em
 * memória e um `setTimeout` a apagava cinco minutos depois. O `ImportService`
 * — 291 linhas que criam a casa de espetáculo, casam compositores, geram slug
 * e gravam `Event` — estava registrado no módulo e **não era chamado por
 * ninguém**. Ou seja: os sete scrapers rodavam, e nada era persistido.
 *
 * **E a checagem de duplicatas quase não existia.** `scrapeAndCheckDuplicates`
 * na classe base não checava nada — o próprio comentário dizia "sem verificação
 * de duplicatas no BaseScraper" — e devolvia `newEvents: <todos>` e
 * `duplicates: 0` sempre, por construção. **Duas das sete casas** (OSESP e
 * Theatro Municipal) sobrescreviam o método com uma verificação de verdade, ao
 * custo de uma consulta por evento; para as outras cinco, o relatório era
 * ficção. As duas sobrescritas saíram: a lógica delas, sem o N+1, é a que o
 * `ImportService` já fazia.
 *
 * Agora a rodada chama `scrapeEvents` — o método primitivo que os sete
 * implementam — e entrega o resultado ao `ImportService`, que é quem sabe
 * reconhecer duplicata e gravar. Um caminho só, igual para todas as casas.
 */
@Injectable()
export class ScraperRunService {
  private readonly logger = new Logger(ScraperRunService.name);

  constructor(
    private readonly registry: ScraperRegistry,
    private readonly importer: ImportService,
  ) {}

  async run(
    scraperId: ScraperId,
    onProgress?: (percent: number, message: string) => void,
  ): Promise<ScraperRunResult> {
    const scraper = this.registry.require(scraperId);
    const venueName = scraper.getConfig().venueName;
    const startedAt = Date.now();

    // O scraper é um singleton do Nest e guarda estado da rodada em `this`.
    // Sem zerar, os erros de uma rodada aparecem no relatório da seguinte.
    scraper.resetState();

    onProgress?.(0, `Lendo a programação de ${venueName}...`);

    // A coleta ocupa os primeiros 80%: é a parte lenta, com dezenas de
    // requisições externas. A importação é banco, e cabe nos 20% finais.
    const events = await scraper.scrapeEvents((current, total, message) => {
      const scale = total > 0 ? current / total : 0;
      onProgress?.(Math.round(scale * 80), message);
    });

    onProgress?.(80, `${events.length} eventos coletados. Importando...`);

    const result = await this.importer.importEvents(scraperId, events);

    onProgress?.(100, 'Concluído');

    const run: ScraperRunResult = {
      scraperId,
      venueName,
      eventsFound: events.length,
      imported: result.imported,
      duplicates: result.duplicates,
      failed: result.failed,
      durationMs: Date.now() - startedAt,
      problems: result.details
        .filter((detail) => detail.status === 'error')
        .slice(0, MAX_PROBLEMS)
        .map((detail) => `${detail.title}: ${detail.message}`),
    };

    this.logger.log(
      `${venueName}: ${run.eventsFound} encontrados, ${run.imported} importados, ` +
        `${run.duplicates} duplicados, ${run.failed} com problema (${run.durationMs}ms)`,
    );

    return run;
  }
}
