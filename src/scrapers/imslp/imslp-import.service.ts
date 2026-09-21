import { escapeRegex } from '../../common/utils/regex.util';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppCacheService } from '../../common/cache/cache.service';
import { CATALOG_NAMESPACES } from '../../common/cache/cache-keys';
import { errorMessage } from '../../common/utils/error.util';
import { ImslpWorkScraper } from './imslp-work.scraper';

export type ImportStatus = 'imported' | 'duplicate' | 'failed';

export interface ImportOutcome {
  imslpUrl: string;
  title: string;
  status: ImportStatus;
  /** Id no catálogo — da obra criada, ou da que já existia. */
  workId?: string;
  reason?: string;
}

export interface ImportSummary {
  composer: { id: string; name: string };
  requested: number;
  imported: number;
  duplicates: number;
  failed: number;
  outcomes: ImportOutcome[];
}

/** Teto de obras por chamada de importação. */
export const MAX_IMPORT_BATCH = 100;

/**
 * Importa obras do IMSLP para o catálogo.
 *
 * **A importação em lote do legado não podia ter funcionado.** Para raspar cada
 * obra, ela fazia o servidor chamar a própria API por HTTP:
 *
 * ```js
 * const scrapingResponse = await fetch(
 *   `${process.env.NEXTAUTH_URL}/api/uploads/work/scraper`,
 *   { method: 'POST', headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ url: work.imslpUrl }) },
 * );
 * ```
 *
 * Sem cookie e sem cabeçalho de autorização — e a rota chamada **exige sessão**
 * (`getServerSession` → 401). Ou seja: toda obra voltava 401, virava
 * `throw new Error('Erro no scraping: Unauthorized')` e era registrada como
 * erro. A importação em lote respondia `success: true` com todas as obras em
 * `status: 'error'`.
 *
 * Aqui o scraper é chamado como o que ele é — um serviço no mesmo processo.
 */
@Injectable()
export class ImslpImportService {
  private readonly logger = new Logger(ImslpImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scraper: ImslpWorkScraper,
    private readonly cache: AppCacheService,
  ) {}

  async importWorks(input: {
    composerId: string;
    urls: string[];
    userId: string;
  }): Promise<ImportSummary> {
    if (input.urls.length === 0 || input.urls.length > MAX_IMPORT_BATCH) {
      throw new BadRequestException(
        `Informe de 1 a ${MAX_IMPORT_BATCH} obras por importação.`,
      );
    }

    const composer = await this.requireComposer(input.composerId);
    const fallbackInstrumentId = await this.fallbackInstrument();

    const outcomes: ImportOutcome[] = [];

    // Uma obra de cada vez: cada uma é uma requisição ao IMSLP, e disparar
    // dezenas em paralelo contra um site de terceiro é o caminho para ser
    // bloqueado. O legado processava três em paralelo com uma pausa de um
    // segundo entre os lotes — a pausa dentro da requisição HTTP.
    for (const url of input.urls) {
      outcomes.push(
        await this.importOne({
          url,
          composer,
          userId: input.userId,
          fallbackInstrumentId,
        }),
      );
    }

    const imported = outcomes.filter(
      (outcome) => outcome.status === 'imported',
    ).length;
    const duplicates = outcomes.filter(
      (outcome) => outcome.status === 'duplicate',
    ).length;

    if (imported > 0) {
      await this.cache.invalidateMany(CATALOG_NAMESPACES);
    }

    const summary: ImportSummary = {
      composer: { id: composer.id, name: composer.fullName ?? composer.name },
      requested: input.urls.length,
      imported,
      duplicates,
      failed: outcomes.length - imported - duplicates,
      outcomes,
    };

    this.logger.log(
      `Importação IMSLP para ${summary.composer.name}: ${summary.imported} novas, ` +
        `${summary.duplicates} já existiam, ${summary.failed} com erro`,
    );

    return summary;
  }

  // -------------------------------------------------------------------

  private async importOne(input: {
    url: string;
    composer: {
      id: string;
      name: string;
      fullName: string | null;
      epochId: string;
      imslpId: string | null;
    };
    userId: string;
    fallbackInstrumentId: string;
  }): Promise<ImportOutcome> {
    try {
      const scraped = await this.scraper.scrape(input.url);

      const mismatch = composerMismatch(scraped, input.composer);

      if (mismatch) {
        return {
          imslpUrl: input.url,
          title: scraped.title,
          status: 'failed',
          reason: mismatch,
        };
      }

      const existing = await this.findExisting(
        input.composer.id,
        scraped.imslpId,
        scraped.title,
      );

      if (existing) {
        return {
          imslpUrl: input.url,
          title: scraped.title,
          status: 'duplicate',
          workId: existing.id,
          reason: 'A obra já está no catálogo',
        };
      }

      const work = await this.prisma.work.create({
        data: {
          title: scraped.title,
          subtitle: scraped.subtitle,
          composerId: input.composer.id,
          instrumentId: await this.resolveInstrument(
            scraped.primaryInstrument,
            input.fallbackInstrumentId,
          ),
          epochId: input.composer.epochId,
          imslpId: scraped.imslpId,
          imslpPermlink: scraped.imslpPermlink,
          opOrCatalog: scraped.opOrCatalog,
          compositionYear: scraped.compositionYear,
          firstPublishDate: scraped.firstPublishDate,
          tone: scraped.tone,
          // `tempoMarking` é lido da página e **não é gravado**: `Work` não tem
          // esse campo. Ele volta na resposta da raspagem, para quem revisa
          // ver, mas não tem onde morar — é o mesmo caso de
          // `verificationNotes` e `dataQuality`, que a fatia 2 do Admin já
          // tinha encontrado em `Work`.
          mediaDuration: scraped.mediaDuration,
          workStyle: scraped.workStyle,
          moviment: scraped.moviment,
          instrumentation: scraped.instrumentation,
          dedicateTo: scraped.dedicateTo,
          categoryNames: scraped.categoryNames,
          workGenresArr: scraped.workGenresArr,
          workType: scraped.workType,
          // Três colunas que `Work` tem e que a portabilidade não estava
          // preenchendo. Medido no catálogo: `difficultyLevel` está em 207.887
          // das 207.892 obras, `imslpTags` em 207.881 e `movementNumber` em
          // 94.781. Deixá-las vazias poria a obra nova fora da convenção de
          // todas as outras.
          movementNumber: scraped.movementNumber,
          imslpTags: scraped.imslpTags,
          difficultyLevel: scraped.difficultyLevel,
          createdBy: input.userId,
          // **Obra importada nasce não verificada.** Ela veio de raspagem de
          // página, não de curadoria: quem confere é gente, pela rota de
          // verificação do painel.
          isVerified: false,
        },
        select: { id: true },
      });

      return {
        imslpUrl: input.url,
        title: scraped.title,
        status: 'imported',
        workId: work.id,
      };
    } catch (error: unknown) {
      this.logger.warn(
        `Falha ao importar ${input.url}: ${errorMessage(error)}`,
      );

      return {
        imslpUrl: input.url,
        title: input.url,
        status: 'failed',
        reason: errorMessage(error),
      };
    }
  }

  /**
   * Procura a obra já existente.
   *
   * Por `imslpId`, que é o identificador da fonte, ou por **título exato** do
   * mesmo compositor.
   *
   * **O legado comparava os 20 primeiros caracteres do título**
   * (`title: { contains: work.title.substring(0, 20) }`). "Prelude and Fugue in
   * C major" e "Prelude and Fugue in C minor" têm os mesmos 20 caracteres
   * iniciais: a segunda era descartada em silêncio como duplicata. Um ciclo
   * inteiro de prelúdios e fugas importava uma obra só.
   */
  private async findExisting(
    composerId: string,
    imslpId: string,
    title: string,
  ) {
    return this.prisma.work.findFirst({
      where: {
        OR: [{ imslpId }, { composerId, title }],
      },
      select: { id: true },
    });
  }

  private async resolveInstrument(
    primaryInstrument: string | null,
    fallbackId: string,
  ): Promise<string> {
    if (!primaryInstrument) {
      return fallbackId;
    }

    const instrument = await this.prisma.instrument.findFirst({
      where: {
        name: { contains: escapeRegex(primaryInstrument), mode: 'insensitive' },
      },
      select: { id: true },
    });

    return instrument?.id ?? fallbackId;
  }

  /**
   * Instrumento de reserva.
   *
   * `Work.instrumentId` é obrigatório e o IMSLP nem sempre diz qual é. O
   * legado usava piano e devolvia **500** quando não achava o registro de
   * piano — um erro de servidor para um catálogo mal semeado. Aqui a falta
   * vira 400 com a instrução do que fazer.
   */
  private async fallbackInstrument(): Promise<string> {
    const piano = await this.prisma.instrument.findFirst({
      where: { name: { contains: 'Piano', mode: 'insensitive' } },
      select: { id: true },
    });

    if (!piano) {
      throw new BadRequestException(
        'O catálogo não tem o instrumento "Piano", usado como reserva quando o IMSLP não informa a instrumentação. Cadastre-o antes de importar.',
      );
    }

    return piano.id;
  }

  private async requireComposer(composerId: string) {
    const composer = await this.prisma.composer.findUnique({
      where: { id: composerId },
      select: {
        id: true,
        name: true,
        fullName: true,
        epochId: true,
        imslpId: true,
        dataSource: true,
      },
    });

    if (!composer) {
      throw new NotFoundException('Compositor não encontrado');
    }

    if (!composer.epochId) {
      throw new BadRequestException(
        `"${composer.fullName ?? composer.name}" não tem época definida, e toda obra precisa de uma.`,
      );
    }

    return composer;
  }
}

/**
 * Diz por que a página raspada não é do compositor pedido — ou `null`.
 *
 * **Sem esta conferência a importação atribui a obra a quem o chamador disser,
 * e o erro fica invisível no catálogo.** A categoria de um compositor no IMSLP
 * lista páginas de redirecionamento, e um redirecionamento pode apontar para
 * a obra de **outro compositor**: `Trauermarsch, Anh.13 (Beethoven, Ludwig
 * van)` leva a `Funeral March No.1 (Walch, Johann Heinrich)`. Rodando contra o
 * IMSLP e o banco reais, foi exatamente o que aconteceu — a obra de Walch
 * entrou no catálogo como sendo de Beethoven, e o registro foi removido depois
 * de este teto existir.
 *
 * A comparação é feita pelo **permalink lido da própria página**, não pelo
 * compositor que o scraper conseguiu casar no catálogo: o casamento por
 * sobrenome é `contains`, e `Walch` casa com `Walcha` — não dá para basear uma
 * recusa nele. Acento, caixa e sublinhado não contam; o resto tem de bater.
 */
export function composerMismatch(
  scraped: { composerPermLink: string | null; composerName: string | null },
  composer: { imslpId: string | null; name: string; fullName: string | null },
): string | null {
  if (!scraped.composerPermLink || !composer.imslpId) {
    // Sem os dois lados não há contradição a apontar: a página não diz de quem
    // é, ou o compositor do catálogo não tem página do IMSLP registrada.
    return null;
  }

  if (
    normalizePermLink(scraped.composerPermLink) ===
    normalizePermLink(composer.imslpId)
  ) {
    return null;
  }

  return (
    `A página é de "${scraped.composerName ?? scraped.composerPermLink}", ` +
    `não de "${composer.fullName ?? composer.name}". ` +
    'O IMSLP lista redirecionamentos na categoria do compositor, e este leva ' +
    'à obra de outra pessoa.'
  );
}

function normalizePermLink(value: string): string {
  return value
    .replace(/_/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
