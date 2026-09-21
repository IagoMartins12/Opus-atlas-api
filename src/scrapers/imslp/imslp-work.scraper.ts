import { escapeRegex } from '../../common/utils/regex.util';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExternalPageFetcher } from './external-page.fetcher';
import {
  CheerioDocument,
  cleanComposerName,
  cleanComposerPermLink,
  cleanTitle,
  dataCompleteness,
  determinePrimaryInstrument,
  determineWorkType,
  extractCategories,
  extractImslpWorkId,
  extractSubtitle,
  extractWorkDetails,
  determineDifficultyLevel,
  DifficultyLevel,
  extractImslpTags,
  extractMovementNumber,
  extractWorkGenres,
  ImslpWorkType,
  mapStyleToEpoch,
  pageQualityOf,
  permLinkVariations,
  stripComposerSuffix,
  translateInstrumentation,
  translateMusicKey,
} from './imslp-work.parser';

export interface ScrapedWork {
  title: string;
  subtitle: string | null;
  imslpPermlink: string;
  imslpId: string;
  composerName: string | null;
  composerPermLink: string | null;
  /** Id no catálogo, quando o compositor já existe. */
  composerId: string | null;
  /**
   * Candidatos encontrados quando a busca não foi conclusiva.
   *
   * Existe porque atribuir a obra ao compositor errado é pior do que deixá-la
   * sem compositor: o erro fica invisível no catálogo e alguém precisa
   * descobri-lo obra a obra.
   */
  composerCandidates: { id: string; name: string }[];
  opOrCatalog: string | null;
  compositionYear: string | null;
  firstPublishDate: string | null;
  tone: string | null;
  tempoMarking: string | null;
  mediaDuration: string | null;
  workStyle: string | null;
  moviment: string | null;
  instrumentation: string | null;
  dedicateTo: string | null;
  categoryNames: string[];
  workGenresArr: string[];
  workType: ImslpWorkType;
  primaryInstrument: string | null;
  /** Número do movimento, do título ou do número de catálogo. */
  movementNumber: number | null;
  /** As categorias da página, cruas — sem passar pelo vocabulário. */
  imslpTags: string[];
  /** Nível na escala do catálogo. Palpite grosseiro; veja o parser. */
  difficultyLevel: DifficultyLevel;
  /** Época **sugerida**: pelo estilo da página, ou pela do compositor. */
  epochName: string | null;
  /** 0 a 100 — quanto da ficha veio preenchido. */
  dataCompleteness: number;
  /** `high` / `medium` / `low`, pela completude. */
  pageQuality: string;
}

const COMPOSER_SELECT = {
  id: true,
  name: true,
  fullName: true,
  imslpId: true,
} as const;

/**
 * Raspa uma página de obra do IMSLP.
 *
 * O parsing mora todo em `imslp-work.parser`, testável sem rede. O que sobra
 * aqui é buscar a página e casar o compositor com o catálogo — as duas coisas
 * que precisam do mundo externo.
 */
@Injectable()
export class ImslpWorkScraper {
  private readonly logger = new Logger(ImslpWorkScraper.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fetcher: ExternalPageFetcher,
  ) {}

  async scrape(rawUrl: string): Promise<ScrapedWork> {
    const { $, url } = await this.fetcher.load(rawUrl, 'imslp');

    const { urlId, pageId, cleanedUrl } = extractImslpWorkId($, url);
    const details = extractWorkDetails($);
    const categoryNames = extractCategories($);

    // O compositor é lido **antes** do título: é ele que diz qual parte do
    // cabeçalho é o nome do compositor acrescentado pelo IMSLP e qual é a obra.
    const workGenresArr = extractWorkGenres($);

    const composer = this.extractComposerLink($);
    const matched = await this.matchComposer(composer.permLink, composer.name);

    const title = stripComposerSuffix(
      cleanTitle($('#firstHeading').text().trim()),
      composer.name,
    );

    const scraped: ScrapedWork = {
      title,
      subtitle: extractSubtitle(title, $),
      imslpPermlink: cleanedUrl,
      // O id numérico da página é melhor, mas o IMSLP não o publica sempre; o
      // nome da página é o que nunca falta.
      imslpId: pageId ?? urlId,
      composerName: composer.name,
      composerPermLink: composer.permLink,
      composerId: matched.id,
      composerCandidates: matched.candidates,
      opOrCatalog: details.opOrCatalog ?? null,
      compositionYear: details.compositionYear ?? null,
      firstPublishDate: details.firstPublishDate ?? null,
      tone: translateMusicKey(details.tone),
      tempoMarking: details.tempoMarking ?? null,
      mediaDuration: details.mediaDuration ?? null,
      workStyle: details.workStyle ?? null,
      moviment: details.moviment ?? null,
      instrumentation: translateInstrumentation(details.instrumentation),
      dedicateTo: details.dedicateTo ?? null,
      categoryNames,
      workGenresArr,
      workType: determineWorkType(title, $),
      primaryInstrument: determinePrimaryInstrument(
        title,
        details.instrumentation,
        categoryNames,
      ),
      movementNumber: extractMovementNumber(details.moviment),
      imslpTags: extractImslpTags($),
      difficultyLevel: determineDifficultyLevel(
        title,
        details.opOrCatalog,
        workGenresArr,
      ),
      epochName: null,
      dataCompleteness: 0,
      pageQuality: 'low',
    };

    scraped.epochName = await this.resolveEpoch(
      details.workStyle,
      scraped.composerId,
    );

    scraped.dataCompleteness = dataCompleteness({
      title: scraped.title,
      composerId: scraped.composerId,
      composerPermLink: scraped.composerPermLink,
      opOrCatalog: scraped.opOrCatalog,
      compositionYear: scraped.compositionYear,
      tone: scraped.tone,
      instrumentation: scraped.instrumentation,
      subtitle: scraped.subtitle,
      epochName: scraped.epochName,
      categoryNames: scraped.categoryNames,
      workGenresArr: scraped.workGenresArr,
    });

    scraped.pageQuality = pageQualityOf(scraped.dataCompleteness);

    this.logger.log(
      `IMSLP: "${scraped.title}" (${scraped.dataCompleteness}% da ficha, ` +
        `compositor ${scraped.composerId ? 'casado' : 'não resolvido'})`,
    );

    return scraped;
  }

  /**
   * A época sugerida para a obra.
   *
   * O estilo declarado na página tem prioridade; na falta dele, a época do
   * compositor. **Só isso é uma sugestão**: a época real da obra pode não ser a
   * do compositor, e é por isso que ela volta na resposta em vez de ir direto
   * para o banco — a importação usa a época do compositor, que é a única que
   * `Work.epochId` aceita.
   */
  private async resolveEpoch(
    workStyle: string | null | undefined,
    composerId: string | null,
  ): Promise<string | null> {
    const fromStyle = mapStyleToEpoch(workStyle);

    if (fromStyle) {
      return fromStyle;
    }

    if (!composerId) {
      return null;
    }

    const composer = await this.prisma.composer.findUnique({
      where: { id: composerId },
      select: { epoch: { select: { name: true } } },
    });

    return composer?.epoch?.name ?? null;
  }

  /** Nome e permalink do compositor, lidos da linha "Composer" da ficha. */
  private extractComposerLink($: CheerioDocument): {
    name: string | null;
    permLink: string | null;
  } {
    let name: string | null = null;
    let permLink: string | null = null;

    $('.wi_body table tr, .wp_header table tr').each((_, element) => {
      const row = $(element);
      const header = row.find('th').first().text().trim().toLowerCase();

      if (!header.includes('composer') && !header.includes('compositor')) {
        return undefined;
      }

      const link = row
        .find('td')
        .first()
        .find('a[href*="/wiki/Category:"]')
        .first();
      const href = link.attr('href');
      const category = href?.match(/\/wiki\/(Category:[^?#]*)/)?.[1];

      if (category) {
        permLink = cleanComposerPermLink(category);
        name = cleanComposerName(link.text().trim());
      }

      return false;
    });

    return { name, permLink };
  }

  /**
   * Casa o permalink do IMSLP com um compositor do catálogo.
   *
   * Primeiro a busca exata, com as variações de acentuação. Se não achar,
   * **a busca parcial não escolhe por conta própria**: `contains` pelo
   * sobrenome casa J. S. Bach, C. P. E. Bach e J. C. Bach com a mesma
   * consulta, e o legado ficava com o primeiro que o banco devolvesse — sem
   * ordenação, sem aviso, e a obra entrava atribuída ao compositor errado.
   * Aqui, mais de um candidato significa **nenhum escolhido**, e a lista volta
   * para quem estiver conduzindo a importação decidir.
   */
  private async matchComposer(
    permLink: string | null,
    composerName: string | null,
  ): Promise<{
    id: string | null;
    candidates: { id: string; name: string }[];
  }> {
    const byPermLink = permLink
      ? await this.findComposer(permLink)
      : { id: null, candidates: [] };

    if (byPermLink.id || byPermLink.candidates.length > 0) {
      return byPermLink;
    }

    // **Reserva por nome**, que o legado tinha e a portabilidade tinha
    // perdido: quando o permalink não casa com nada — compositor cadastrado à
    // mão, sem `imslpId` —, o nome escrito na página ainda pode achá-lo. É
    // busca exata, sem `contains`: um `contains` por nome traria de volta o
    // problema que a busca por permalink já evita.
    if (!composerName) {
      return byPermLink;
    }

    const byName = await this.prisma.composer.findFirst({
      where: {
        fullName: { equals: escapeRegex(composerName), mode: 'insensitive' },
      },
      select: COMPOSER_SELECT,
    });

    return byName
      ? { id: byName.id, candidates: [] }
      : { id: null, candidates: [] };
  }

  private async findComposer(permLink: string): Promise<{
    id: string | null;
    candidates: { id: string; name: string }[];
  }> {
    for (const variation of permLinkVariations(permLink)) {
      const exact = await this.prisma.composer.findFirst({
        where: { imslpId: variation },
        select: COMPOSER_SELECT,
      });

      if (exact) {
        return { id: exact.id, candidates: [] };
      }
    }

    const surname = permLink.replace('Category:', '').split(',')[0].trim();

    if (!surname) {
      return { id: null, candidates: [] };
    }

    const partial = await this.prisma.composer.findMany({
      where: {
        imslpId: { contains: escapeRegex(surname), mode: 'insensitive' },
      },
      select: COMPOSER_SELECT,
      take: 10,
    });

    if (partial.length === 1) {
      return { id: partial[0].id, candidates: [] };
    }

    return {
      id: null,
      candidates: partial.map((composer) => ({
        id: composer.id,
        name: composer.fullName ?? composer.name,
      })),
    };
  }
}
