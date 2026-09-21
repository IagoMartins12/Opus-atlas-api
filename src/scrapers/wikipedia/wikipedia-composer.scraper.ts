import { escapeRegex } from '../../common/utils/regex.util';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WikipediaComposerClient } from './wikipedia-composer.client';
import {
  composerCompleteness,
  epochByBirthYear,
  formatWikidataDate,
  resolveNationality,
  surnameOf,
} from './wikipedia-composer.parser';

export interface ScrapedComposer {
  /** Sobrenome — o que o catálogo guarda em `Composer.name`. */
  name: string;
  fullName: string;
  birthDate: string | null;
  deathDate: string | null;
  portraitUrl: string | null;
  bio: string | null;
  nationality: string | null;
  wikipediaLink: string;
  /** Época **sugerida** pelo ano de nascimento; quem confirma é gente. */
  epochName: string;
  /** Id no catálogo, quando o compositor já existe. */
  composerId: string | null;
  /** Candidatos, quando a busca não foi conclusiva. */
  composerCandidates: { id: string; name: string }[];
  /** Fontes de onde cada metade veio, para quem revisa saber no que confiar. */
  sources: { wikipedia: string; wikidata: string | null };
  /** 0 a 100 — quanto da ficha veio preenchido. */
  dataCompleteness: number;
}

const COMPOSER_SELECT = {
  id: true,
  name: true,
  fullName: true,
} as const;

/** Quantos candidatos voltam quando o nome não resolve sozinho. */
const MAX_CANDIDATES = 10;

/**
 * Raspa a ficha de um compositor na Wikipedia.
 *
 * **Não grava nada.** Responde "o que a Wikipedia e o Wikidata dizem", e quem
 * decide o que fazer com isso é o cadastro de compositor, com revisão. É a
 * mesma separação do catálogo do IMSLP, e pelo mesmo motivo: dado de raspagem
 * não é curadoria.
 */
@Injectable()
export class WikipediaComposerScraper {
  private readonly logger = new Logger(WikipediaComposerScraper.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: WikipediaComposerClient,
  ) {}

  async scrape(rawUrl: string): Promise<ScrapedComposer> {
    const article = await this.client.article(rawUrl);

    // O Wikidata é opcional: um artigo sem item ainda dá nome, resumo e
    // retrato. O que falta volta nulo, e a completude cai — que é a
    // informação certa para quem revisa.
    const person = article.wikidataId
      ? await this.client.person(article.wikidataId, article.language)
      : { birth: null, death: null, countryLabel: null };

    const birthDate = formatWikidataDate(person.birth);
    const deathDate = formatWikidataDate(person.death);
    const nationality = resolveNationality(
      person.countryLabel,
      article.summary,
    );

    const matched = await this.findComposer(article.title);

    const scraped: ScrapedComposer = {
      name: surnameOf(article.title),
      fullName: article.title,
      birthDate,
      deathDate,
      portraitUrl: article.portraitUrl,
      bio: article.summary,
      nationality,
      wikipediaLink: article.url,
      epochName: epochByBirthYear(birthDate),
      composerId: matched.id,
      composerCandidates: matched.candidates,
      sources: {
        wikipedia: article.url,
        wikidata: article.wikidataId
          ? `https://www.wikidata.org/wiki/${article.wikidataId}`
          : null,
      },
      dataCompleteness: composerCompleteness({
        bio: article.summary,
        birthDate,
        deathDate,
        nationality,
        portraitUrl: article.portraitUrl,
      }),
    };

    this.logger.log(
      `Wikipedia: "${scraped.fullName}" (${scraped.dataCompleteness}% da ficha, ` +
        `${scraped.composerId ? 'já no catálogo' : 'não encontrado no catálogo'})`,
    );

    return scraped;
  }

  /**
   * Procura o compositor no catálogo pelo nome completo.
   *
   * **Mais de um candidato significa nenhum escolhido**, como na leitura de
   * obra do IMSLP: atribuir a ficha ao compositor errado sobrescreveria dado
   * bom com dado de outra pessoa, e o erro fica invisível no catálogo.
   */
  private async findComposer(fullName: string): Promise<{
    id: string | null;
    candidates: { id: string; name: string }[];
  }> {
    const exact = await this.prisma.composer.findFirst({
      where: {
        fullName: { equals: escapeRegex(fullName), mode: 'insensitive' },
      },
      select: COMPOSER_SELECT,
    });

    if (exact) {
      return { id: exact.id, candidates: [] };
    }

    const partial = await this.prisma.composer.findMany({
      where: {
        fullName: {
          contains: escapeRegex(surnameOf(fullName)),
          mode: 'insensitive',
        },
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
