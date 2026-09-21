import { escapeRegex } from '../../common/utils/regex.util';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { epochByBirthYear } from '../composers/epoch';
import { ExternalPageFetcher } from './external-page.fetcher';
import {
  determineRole,
  evaluatePageQuality,
  extractAlternativeNames,
  extractComposerCategories,
  extractComposerDates,
  extractComposerInstruments,
  extractComposerNationality,
  extractNameAndFullName,
  extractPortraitUrl,
  extractWikipediaLink,
} from './imslp-composer.parser';
import { cleanComposerPermLink, permLinkVariations } from './imslp-work.parser';

export interface ScrapedImslpComposer {
  /** Sobrenome — o que o catálogo guarda em `Composer.name`. */
  name: string;
  fullName: string;
  alternativeNames: string | null;
  birthDate: string | null;
  deathDate: string | null;
  portraitUrl: string | null;
  bio: string | null;
  imslpId: string;
  wikipediaLink: string | null;
  nationality: string | null;
  instruments: string | null;
  imslpCategories: string | null;
  primaryRole: string | null;
  roles: string | null;
  pageQuality: string;
  dataCompleteness: number;
  hasValidImage: boolean;
  /** Época **sugerida** pelo ano de nascimento; quem confirma é gente. */
  epochName: string;
  /** Id no catálogo, quando o compositor já existe. */
  composerId: string | null;
  /** Candidatos, quando a busca não foi conclusiva. */
  composerCandidates: { id: string; name: string }[];
}

const COMPOSER_SELECT = {
  id: true,
  name: true,
  fullName: true,
} as const;

/** Quantos candidatos voltam quando o `imslpId` não casa exato. */
const MAX_CANDIDATES = 10;

/**
 * Raspa a página de um compositor no IMSLP.
 *
 * Porte de `scrapeIMSLP`. **Não grava nada**: responde o que a página diz, e o
 * cadastro decide. `bio` volta sempre nulo, como no legado — a página de
 * compositor do IMSLP não tem biografia; é a Wikipedia que tem.
 */
@Injectable()
export class ImslpComposerScraper {
  private readonly logger = new Logger(ImslpComposerScraper.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fetcher: ExternalPageFetcher,
  ) {}

  async scrape(rawUrl: string): Promise<ScrapedImslpComposer> {
    const { $, url } = await this.fetcher.load(rawUrl, 'imslp');

    // O identificador é o nome da página: `Category:Satie,_Erik`.
    const imslpId = decodeSafely(url.split('/wiki/')[1] ?? '');

    const { name, fullName } = extractNameAndFullName(imslpId, $);
    const dates = extractComposerDates($);
    const quality = evaluatePageQuality($);
    const role = determineRole($);

    const matched = imslpId
      ? await this.findComposer(cleanComposerPermLink(imslpId))
      : { id: null, candidates: [] };

    const scraped: ScrapedImslpComposer = {
      name,
      fullName,
      alternativeNames: extractAlternativeNames($),
      birthDate: dates.birthDate,
      deathDate: dates.deathDate,
      portraitUrl: extractPortraitUrl($),
      // A página de compositor do IMSLP não tem biografia.
      bio: null,
      imslpId,
      wikipediaLink: extractWikipediaLink($),
      nationality: extractComposerNationality($),
      instruments: extractComposerInstruments($),
      imslpCategories: extractComposerCategories($),
      primaryRole: role.primaryRole,
      roles: role.roles,
      pageQuality: quality.pageQuality,
      dataCompleteness: quality.dataCompleteness,
      hasValidImage: quality.hasValidImage,
      epochName: epochByBirthYear(dates.birthDate),
      composerId: matched.id,
      composerCandidates: matched.candidates,
    };

    this.logger.log(
      `IMSLP: compositor "${scraped.fullName}" (${scraped.dataCompleteness}% da ` +
        `ficha, página ${scraped.pageQuality}, ` +
        `${scraped.composerId ? 'já no catálogo' : 'não encontrado no catálogo'})`,
    );

    return scraped;
  }

  /**
   * Casa o identificador da página com um compositor do catálogo.
   *
   * Mesma regra da leitura de obra: exato primeiro, com as variações de
   * acentuação; **mais de um candidato significa nenhum escolhido**, porque
   * sobrescrever a ficha do compositor errado troca dado bom por dado de outra
   * pessoa e o erro fica invisível no catálogo.
   */
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
      take: MAX_CANDIDATES,
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

function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
