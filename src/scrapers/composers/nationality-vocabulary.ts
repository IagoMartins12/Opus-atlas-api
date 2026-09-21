/**
 * Vocabulário de nacionalidades.
 *
 * **Veio do legado como dado, não reescrito.** São 46 nacionalidades com os
 * termos em que cada uma aparece escrita numa página — em inglês, em português
 * e no idioma do país — construídas ao longo do tempo contra páginas reais. No
 * legado viviam em `src/app/data/`, importadas pelo scraper e pela tela de
 * cadastro ao mesmo tempo.
 */

export interface Nationality {
  id: string;
  name: string;
  countries: string[];
  searchTerms: string[];
}

export const NATIONALITIES: Nationality[] = [
  {
    id: 'alemao',
    name: 'Alemão',
    countries: ['Germany', 'Deutschland', 'Alemanha'],
    searchTerms: [
      'german',
      'deutsch',
      'deutschland',
      'germany',
      'alemão',
      'alemã',
      'alemanha',
    ],
  },
  {
    id: 'austriaco',
    name: 'Austríaco',
    countries: ['Austria', 'Österreich', 'Áustria'],
    searchTerms: [
      'austrian',
      'austria',
      'österreich',
      'austríaco',
      'austríaca',
      'áustria',
    ],
  },
  {
    id: 'frances',
    name: 'Francês',
    countries: ['France', 'França'],
    searchTerms: [
      'french',
      'france',
      'français',
      'française',
      'francês',
      'francesa',
      'frança',
    ],
  },
  {
    id: 'italiano',
    name: 'Italiano',
    countries: ['Italy', 'Italia', 'Itália'],
    searchTerms: [
      'italian',
      'italy',
      'italia',
      'italiano',
      'italiana',
      'itália',
    ],
  },
  {
    id: 'russo',
    name: 'Russo',
    countries: ['Russia', 'Russian Federation', 'Rússia'],
    searchTerms: [
      'russian',
      'russia',
      'russo',
      'russa',
      'rússia',
      'советский',
      'soviet',
    ],
  },
  {
    id: 'britanico',
    name: 'Britânico',
    countries: [
      'United Kingdom',
      'England',
      'Britain',
      'Reino Unido',
      'Inglaterra',
    ],
    searchTerms: [
      'british',
      'english',
      'england',
      'uk',
      'united kingdom',
      'britain',
      'britânico',
      'britânica',
      'inglês',
      'inglesa',
      'reino unido',
      'inglaterra',
    ],
  },
  {
    id: 'americano',
    name: 'Americano',
    countries: ['United States', 'USA', 'America', 'Estados Unidos'],
    searchTerms: [
      'american',
      'usa',
      'united states',
      'america',
      'americano',
      'americana',
      'estados unidos',
      'eua',
    ],
  },
  {
    id: 'polones',
    name: 'Polonês',
    countries: ['Poland', 'Polska', 'Polônia'],
    searchTerms: [
      'polish',
      'poland',
      'polska',
      'polonês',
      'polonesa',
      'polônia',
    ],
  },
  {
    id: 'espanhol',
    name: 'Espanhol',
    countries: ['Spain', 'España', 'Espanha'],
    searchTerms: [
      'spanish',
      'spain',
      'españa',
      'espanhol',
      'espanhola',
      'espanha',
    ],
  },
  {
    id: 'tcheco',
    name: 'Tcheco',
    countries: [
      'Czech Republic',
      'Czechoslovakia',
      'Bohemia',
      'República Tcheca',
    ],
    searchTerms: [
      'czech',
      'bohemian',
      'czechoslovak',
      'czechoslovakia',
      'tcheco',
      'tcheca',
      'república tcheca',
      'boêmio',
      'boêmia',
    ],
  },
  {
    id: 'hungaro',
    name: 'Húngaro',
    countries: ['Hungary', 'Hungria'],
    searchTerms: [
      'hungarian',
      'hungary',
      'magyar',
      'húngaro',
      'húngara',
      'hungria',
    ],
  },
  {
    id: 'holandes',
    name: 'Holandês',
    countries: ['Netherlands', 'Holland', 'Nederland', 'Holanda'],
    searchTerms: [
      'dutch',
      'netherlands',
      'holland',
      'nederland',
      'holandês',
      'holandesa',
      'holanda',
      'países baixos',
    ],
  },
  {
    id: 'belga',
    name: 'Belga',
    countries: ['Belgium', 'Belgique', 'België', 'Bélgica'],
    searchTerms: [
      'belgian',
      'belgium',
      'belgique',
      'belgië',
      'belga',
      'bélgica',
    ],
  },
  {
    id: 'suico',
    name: 'Suíço',
    countries: ['Switzerland', 'Schweiz', 'Suisse', 'Suíça'],
    searchTerms: [
      'swiss',
      'switzerland',
      'schweiz',
      'suisse',
      'suíço',
      'suíça',
    ],
  },
  {
    id: 'brasileiro',
    name: 'Brasileiro',
    countries: ['Brazil', 'Brasil'],
    searchTerms: ['brazilian', 'brazil', 'brasil', 'brasileiro', 'brasileira'],
  },
  {
    id: 'japones',
    name: 'Japonês',
    countries: ['Japan', 'Japão', '日本'],
    searchTerms: [
      'japanese',
      'japan',
      'japão',
      'japonês',
      'japonesa',
      '日本',
      'nippon',
      'nihon',
    ],
  },
  {
    id: 'chines',
    name: 'Chinês',
    countries: ['China', '中国', 'República Popular da China'],
    searchTerms: [
      'chinese',
      'china',
      'chinês',
      'chinesa',
      '中国',
      'república popular da china',
    ],
  },
  {
    id: 'coreano',
    name: 'Coreano',
    countries: ['Korea', 'South Korea', 'North Korea', 'Coreia'],
    searchTerms: [
      'korean',
      'korea',
      'south korea',
      'north korea',
      'coreano',
      'coreana',
      'coreia',
      '한국',
    ],
  },
  {
    id: 'mexicano',
    name: 'Mexicano',
    countries: ['Mexico', 'México'],
    searchTerms: ['mexican', 'mexico', 'mexicano', 'mexicana', 'méxico'],
  },
  {
    id: 'argentino',
    name: 'Argentino',
    countries: ['Argentina'],
    searchTerms: ['argentinian', 'argentina', 'argentino', 'argentina'],
  },
  {
    id: 'chileno',
    name: 'Chileno',
    countries: ['Chile'],
    searchTerms: ['chilean', 'chile', 'chileno', 'chilena'],
  },
  {
    id: 'peruano',
    name: 'Peruano',
    countries: ['Peru'],
    searchTerms: ['peruvian', 'peru', 'peruano', 'peruana'],
  },
  {
    id: 'venezuelano',
    name: 'Venezuelano',
    countries: ['Venezuela'],
    searchTerms: ['venezuelan', 'venezuela', 'venezuelano', 'venezuelana'],
  },
  {
    id: 'colombiano',
    name: 'Colombiano',
    countries: ['Colombia', 'Colômbia'],
    searchTerms: [
      'colombian',
      'colombia',
      'colombiano',
      'colombiana',
      'colômbia',
    ],
  },
  {
    id: 'uruguaio',
    name: 'Uruguaio',
    countries: ['Uruguay', 'Uruguai'],
    searchTerms: ['uruguayan', 'uruguay', 'uruguaio', 'uruguaia', 'uruguai'],
  },
  {
    id: 'canadense',
    name: 'Canadense',
    countries: ['Canada', 'Canadá'],
    searchTerms: ['canadian', 'canada', 'canadense', 'canadá'],
  },
  {
    id: 'indiano',
    name: 'Indiano',
    countries: ['India', 'Índia'],
    searchTerms: ['indian', 'india', 'indiano', 'indiana', 'índia'],
  },
  {
    id: 'australiano',
    name: 'Australiano',
    countries: ['Australia', 'Austrália'],
    searchTerms: [
      'australian',
      'australia',
      'australiano',
      'australiana',
      'austrália',
    ],
  },
  {
    id: 'neozerlandes',
    name: 'Neozelandês',
    countries: ['New Zealand', 'Nova Zelândia'],
    searchTerms: [
      'new zealand',
      'new zealander',
      'neozelandês',
      'neozelandesa',
      'nova zelândia',
    ],
  },
  {
    id: 'sul_africano',
    name: 'Sul-africano',
    countries: ['South Africa', 'África do Sul'],
    searchTerms: [
      'south african',
      'south africa',
      'sul-africano',
      'sul-africana',
      'áfrica do sul',
    ],
  },
  {
    id: 'egipcio',
    name: 'Egípcio',
    countries: ['Egypt', 'Egito'],
    searchTerms: ['egyptian', 'egypt', 'egípcio', 'egípcia', 'egito'],
  },
  {
    id: 'turco',
    name: 'Turco',
    countries: ['Turkey', 'Türkiye', 'Turquia'],
    searchTerms: ['turkish', 'turkey', 'türkiye', 'turco', 'turca', 'turquia'],
  },
  {
    id: 'grego',
    name: 'Grego',
    countries: ['Greece', 'Grécia', 'Ελλάδα'],
    searchTerms: ['greek', 'greece', 'grego', 'grega', 'grécia', 'ελληνικός'],
  },
  {
    id: 'irlandes',
    name: 'Irlandês',
    countries: ['Ireland', 'Irlanda'],
    searchTerms: ['irish', 'ireland', 'irlandês', 'irlandesa', 'irlanda'],
  },
  {
    id: 'escoces',
    name: 'Escocês',
    countries: ['Scotland', 'Escócia'],
    searchTerms: ['scottish', 'scotland', 'escocês', 'escocesa', 'escócia'],
  },
  {
    id: 'gales',
    name: 'Galês',
    countries: ['Wales', 'Gales'],
    searchTerms: ['welsh', 'wales', 'galês', 'galesa', 'gales'],
  },
  {
    id: 'portugues',
    name: 'Português',
    countries: ['Portugal'],
    searchTerms: ['portuguese', 'portugal', 'português', 'portuguesa'],
  },
  {
    id: 'finlandes',
    name: 'Finlandês',
    countries: ['Finland', 'Suomi', 'Finlândia'],
    searchTerms: [
      'finnish',
      'finland',
      'suomi',
      'finlandês',
      'finlandesa',
      'finlândia',
    ],
  },
  {
    id: 'noruegues',
    name: 'Norueguês',
    countries: ['Norway', 'Norge', 'Noruega'],
    searchTerms: [
      'norwegian',
      'norway',
      'norge',
      'norueguês',
      'norueguesa',
      'noruega',
    ],
  },
  {
    id: 'sueco',
    name: 'Sueco',
    countries: ['Sweden', 'Sverige', 'Suécia'],
    searchTerms: ['swedish', 'sweden', 'sverige', 'sueco', 'sueca', 'suécia'],
  },
  {
    id: 'dinamarques',
    name: 'Dinamarquês',
    countries: ['Denmark', 'Danmark', 'Dinamarca'],
    searchTerms: [
      'danish',
      'denmark',
      'danmark',
      'dinamarquês',
      'dinamarquesa',
      'dinamarca',
    ],
  },
  {
    id: 'isranlense',
    name: 'Israelense',
    countries: ['Israel'],
    searchTerms: ['israeli', 'israel', 'israelense', 'hebreu', 'hebrew'],
  },
  {
    id: 'ucraniano',
    name: 'Ucraniano',
    countries: ['Ukraine', 'Ucrânia'],
    searchTerms: ['ukrainian', 'ukraine', 'ucraniano', 'ucraniana', 'ucrânia'],
  },
  {
    id: 'romeno',
    name: 'Romeno',
    countries: ['Romania', 'Romênia'],
    searchTerms: ['romanian', 'romania', 'romeno', 'romena', 'romênia'],
  },
  {
    id: 'bulgaro',
    name: 'Búlgaro',
    countries: ['Bulgaria', 'Bulgária'],
    searchTerms: ['bulgarian', 'bulgaria', 'búlgaro', 'búlgara', 'bulgária'],
  },
  {
    id: 'croata',
    name: 'Croata',
    countries: ['Croatia', 'Croácia'],
    searchTerms: ['croatian', 'croatia', 'croata', 'croácia'],
  },
  {
    id: 'servio',
    name: 'Sérvio',
    countries: ['Serbia', 'Sérvia'],
    searchTerms: ['serbian', 'serbia', 'sérvio', 'sérvia', 'sérvia'],
  },
  {
    id: 'lituano',
    name: 'Lituano',
    countries: ['Lithuania', 'Lituânia'],
    searchTerms: ['lithuanian', 'lithuania', 'lituano', 'lituana', 'lituânia'],
  },
  {
    id: 'letao',
    name: 'Letão',
    countries: ['Latvia', 'Letônia'],
    searchTerms: ['latvian', 'latvia', 'letão', 'letã', 'letônia'],
  },
  {
    id: 'estoniano',
    name: 'Estoniano',
    countries: ['Estonia', 'Estônia'],
    searchTerms: ['estonian', 'estonia', 'estoniano', 'estoniana', 'estônia'],
  },
];

/**
 * A nacionalidade que o texto denuncia, ou `null`.
 *
 * **A comparação é por palavra inteira, e não por subcadeia.** O legado usava
 * `text.includes(term)`, e isso produziu dado errado no catálogo: a página do
 * IMSLP do Villa-Lobos tem a categoria `PeopleNonPD-USandEU`, cujo texto em
 * minúsculas contém "usa" dentro de "USandEU". Como "USA" está na tabela e
 * Americano vem antes de Brasileiro, **o compositor brasileiro entrou no
 * catálogo como americano** — e está assim até hoje nas 19.177 fichas. Exigir
 * que o termo não esteja grudado em outra letra ou dígito resolve a classe
 * inteira do problema.
 *
 * **A ordem da lista ainda decide o empate**, e isso continua deliberado: um
 * texto que cita dois países casa com o primeiro da tabela. Não há informação
 * na página para desempatar, e escolher o primeiro é ao menos previsível.
 */
export function findNationalityByText(text: string): string | null {
  if (!text) {
    return null;
  }

  for (const nationality of NATIONALITIES) {
    const found = [...nationality.countries, ...nationality.searchTerms].some(
      (term) => matchesWholeWord(text, term),
    );

    if (found) {
      return nationality.name;
    }
  }

  return null;
}

/** O termo aparece no texto sem estar grudado em outra letra ou dígito. */
export function matchesWholeWord(text: string, term: string): boolean {
  if (!term) {
    return false;
  }

  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
    'iu',
  ).test(text);
}
