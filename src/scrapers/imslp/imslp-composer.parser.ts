import { findNationalityByText } from '../composers/nationality-vocabulary';
import { CheerioDocument } from './imslp-work.parser';

/**
 * Leitura da página de **compositor** do IMSLP.
 *
 * Porte de `scrapeIMSLP` e das suas onze auxiliares em
 * `app/api/uploads/external-sources/scraper/route.ts`. Os seletores são os
 * mesmos, porque são eles que casam com a estrutura real da página: `.cp_firsth`
 * (cabeçalho com nome e datas), `.cp_img` (retrato), `.cp_mainlinks` (nomes
 * alternativos), `.cp_links` (links externos) e `#mw-pages` (as seções que
 * revelam o papel da pessoa).
 *
 * O que mudou em relação ao legado é o que estava **errado ou faltando**, e
 * está anotado em cada função.
 */

/** Imagem que o IMSLP usa quando não tem retrato. */
const NO_PHOTO = 'Nocomposerphotoavailable';

/**
 * Nome e nome completo, a partir do identificador da página.
 *
 * O `imslpId` é `Category:Sobrenome,_Nome` — daí saem `name: "Satie"` e
 * `fullName: "Erik Satie"`. O cabeçalho da página tem prioridade quando é mais
 * longo, porque é lá que aparece o nome inteiro com nomes do meio.
 */
export function extractNameAndFullName(
  imslpId: string,
  $: CheerioDocument,
): { name: string; fullName: string } {
  let name = '';
  let fullName = '';

  if (imslpId) {
    const parts = imslpId.replace('Category:', '').split(',');

    if (parts.length >= 2) {
      // **O sublinhado sai antes do `trim`.** O legado fazia
      // `parts[1].trim().replace(/_/g, ' ')`, e o identificador é
      // `Category:Satie,_Erik`: depois da vírgula vem `_Erik`, que o `trim`
      // não corta porque `_` não é espaço. O sublinhado virava espaço só
      // depois, e o nome ia para o catálogo como `" Erik Satie"`, com espaço
      // na frente.
      const lastName = parts[0].replace(/_/g, ' ').trim();
      const firstName = parts[1].replace(/_/g, ' ').trim();

      name = lastName;
      fullName = `${firstName} ${lastName}`;
    } else {
      name = parts[0].replace(/_/g, ' ').trim();
      fullName = name;
    }
  }

  const headline = $('.cp_firsth')
    .find('h2 .mw-headline')
    .first()
    .text()
    .trim();

  if (headline && headline.length > fullName.length) {
    fullName = headline;
  }

  return { name, fullName };
}

/** Nomes alternativos e transliterações, do bloco de links principais. */
export function extractAlternativeNames($: CheerioDocument): string | null {
  const LABELS = [
    'Nomes alternativos/Transliterações:',
    'Alternative Names/Transliterations:',
  ];

  let alternativeNames: string | null = null;

  $('.cp_mainlinks')
    .find('span[style="font-weight:normal"]')
    .each((_, element) => {
      const text = $(element).text().trim();

      if (!LABELS.some((label) => text.includes(label))) {
        return undefined;
      }

      alternativeNames = LABELS.reduce(
        (value, label) => value.replace(label, ''),
        text,
      ).trim();

      return false;
    });

  return alternativeNames || null;
}

/** O retrato, quando a página tem um de verdade. */
export function extractPortraitUrl($: CheerioDocument): string | null {
  const src = $('.cp_img img').first().attr('src');

  if (!src || src.includes(NO_PHOTO)) {
    return null;
  }

  return src.startsWith('/') ? `https://imslp.org${src}` : src;
}

/**
 * As categorias do IMSLP, como texto.
 *
 * **O bloco de categorias da página tem prioridade sobre a varredura ampla.**
 * O legado pegava todo `a[href*="Category:"]` do documento, e isso arrasta a
 * navegação do MediaWiki junto: medido na página do Villa-Lobos, o campo saía
 * como `"Category, View source, History, What links here, Related changes,
 * Printable version, Permanent link, ..., http://imslp.org/index.php?title=...
 * &oldid=3936680, ..."` — com o endereço de revisão da página dentro de um
 * campo chamado "categorias". `#catlinks` é onde o MediaWiki publica as
 * categorias de verdade; a varredura ampla fica como reserva, para página que
 * não tenha o bloco.
 *
 * Isso importa duas vezes: o campo vai para o catálogo **e** é uma das fontes
 * de onde a nacionalidade é lida.
 */
export function extractComposerCategories($: CheerioDocument): string | null {
  const fromBlock = collectCategories($, '#catlinks a[href*="Category:"]');

  if (fromBlock.length > 0) {
    return fromBlock.join(', ');
  }

  const anywhere = collectCategories($, 'a[href*="Category:"]');

  return anywhere.length > 0 ? anywhere.join(', ') : null;
}

function collectCategories($: CheerioDocument, selector: string): string[] {
  const categories = new Set<string>();

  $(selector).each((_, element) => {
    const text = $(element).text().trim();

    if (text && !text.includes('IMSLP') && text.length > 2) {
      categories.add(text);
    }
  });

  return [...categories];
}

/** Os links externos da página, como texto. */
export function extractExternalLinks($: CheerioDocument): string | null {
  const header = $('h2').find('span[id*="Links_externos"]').first();

  if (header.length === 0) {
    return null;
  }

  const section = header.closest('h2').next('.cp_links');

  if (section.length === 0) {
    return null;
  }

  const links: string[] = [];

  section.find('li').each((_, element) => {
    const item = $(element);
    const text = item.text().trim();
    const href = item.find('a').attr('href');

    if (text && href) {
      links.push(`${text} (${href})`);
    } else if (text) {
      links.push(text);
    }
  });

  const joined = links.join('; ');

  return joined.length > 5 ? joined : null;
}

/** O link para a Wikipedia, se a página tiver um. */
export function extractWikipediaLink($: CheerioDocument): string | null {
  const links = $('.cp_links').find('a');

  if (links.length === 0) {
    return null;
  }

  let found: string | null = null;

  links.each((_, element) => {
    const href = $(element).attr('href');
    const text = $(element).text().toLowerCase();

    if (
      href &&
      (href.includes('wikipedia.org') ||
        href.includes('wiki/') ||
        text.includes('wikipedia'))
    ) {
      found = href.startsWith('http://')
        ? href.replace('http://', 'https://')
        : href;

      return false;
    }

    return undefined;
  });

  return found;
}

/** Instrumentos citados na página, entre os que o legado reconhecia. */
const COMMON_INSTRUMENTS = [
  'Piano',
  'Violino',
  'Viola',
  'Violoncelo',
  'Contrabaixo',
  'Flauta',
  'Oboé',
  'Clarinete',
  'Fagote',
  'Trompa',
  'Trompete',
  'Trombone',
  'Tuba',
  'Harpa',
  'Violão',
  'Órgão',
  'Cravo',
  'Voz',
  'Soprano',
  'Alto',
  'Tenor',
  'Baixo',
  'Coro',
  'Orquestra',
];

/** Quantos instrumentos entram na ficha. */
const MAX_INSTRUMENTS = 10;

/**
 * Instrumentos associados ao compositor.
 *
 * **A lista é em português e a página do IMSLP é em inglês.** Procurar
 * `"for violino"` no texto de uma página inglesa não acha nada — dos 24 nomes,
 * só os que se escrevem igual nos dois idiomas (`piano`, `viola`, `alto`,
 * `tenor`) têm chance. Isto vem do legado tal como está: o campo
 * `Composer.instruments` quase sempre volta nulo, e não é defeito de porte.
 */
export function extractComposerInstruments($: CheerioDocument): string | null {
  const text = $('body').text().toLowerCase();

  const found = COMMON_INSTRUMENTS.filter((instrument) => {
    const needle = instrument.toLowerCase();

    return (
      text.includes(`${needle} works`) ||
      text.includes(`for ${needle}`) ||
      text.includes(`${needle} compositions`)
    );
  });

  return found.length > 0
    ? [...new Set(found)].slice(0, MAX_INSTRUMENTS).join(', ')
    : null;
}

/** As seções da página que revelam o que a pessoa fez. */
const ROLES_BY_SECTION: Record<string, string> = {
  'performances by': 'Cantor',
  'compositions by': 'Compositor',
  'works with text by': 'Libretista',
  'arrangements by': 'Arranjador',
  'works edited by': 'Editor',
  'books by': 'Escritor',
  'works translated by': 'Tradutor',
};

/**
 * Papel principal e demais papéis.
 *
 * O IMSLP separa a listagem por seção — "Compositions by", "Arrangements by" —
 * e é isso que diz se a pessoa entrou no catálogo como compositor, arranjador
 * ou libretista. O primeiro que aparece vira o principal.
 */
export function determineRole($: CheerioDocument): {
  primaryRole: string | null;
  roles: string | null;
} {
  const section = $('#mw-pages');

  if (section.length === 0) {
    return { primaryRole: null, roles: null };
  }

  const found: string[] = [];

  section.find('h2').each((_, element) => {
    const text = $(element).text().trim().toLowerCase();
    const key = Object.keys(ROLES_BY_SECTION).find((candidate) =>
      text.includes(candidate),
    );

    if (key) {
      found.push(ROLES_BY_SECTION[key]);
    }
  });

  return {
    primaryRole: found[0] ?? null,
    roles: found.length > 1 ? found.slice(1).join(', ') : null,
  };
}

/** Pontos da avaliação de qualidade da página. */
const QUALITY_MAX = 8;
const QUALITY_HIGH = 80;
const QUALITY_MEDIUM = 60;

/**
 * Qualidade da página e quanto dela veio preenchido.
 *
 * Oito sinais, cada um valendo um ponto: cabeçalho, datas entre parênteses,
 * retrato de verdade, links, listagem de obras, cabeçalho longo, link da
 * Wikipedia e bloco de nomes alternativos.
 */
export function evaluatePageQuality($: CheerioDocument): {
  pageQuality: string;
  dataCompleteness: number;
  hasValidImage: boolean;
} {
  const firsth = $('.cp_firsth');
  const firsthText = firsth.text();
  const image = $('.cp_img img');

  const hasValidImage =
    image.length > 0 && !image.attr('src')?.includes(NO_PHOTO);

  const signals = [
    firsth.find('h2').length > 0,
    firsthText.includes('(') && firsthText.includes(')'),
    hasValidImage,
    $('.cp_links a').length > 0,
    $('#mw-pages').length > 0,
    firsthText.length > 100,
    $('a[href*="wikipedia"]').length > 0,
    $('.cp_mainlinks').length > 0,
  ];

  const percentage = Math.round(
    (signals.filter(Boolean).length / QUALITY_MAX) * 100,
  );

  return {
    pageQuality:
      percentage >= QUALITY_HIGH
        ? 'high'
        : percentage >= QUALITY_MEDIUM
          ? 'medium'
          : 'low',
    dataCompleteness: percentage,
    hasValidImage,
  };
}

/**
 * A nacionalidade, procurada onde ela costuma estar.
 *
 * Três lugares, na ordem do legado: o cabeçalho, as categorias e os links
 * externos. **O legado numerava 1, 2 e 4** — o passo 3 tinha sido removido e a
 * numeração ficou com um buraco, o que fazia parecer que faltava uma
 * estratégia. Não falta: são três.
 */
export function extractComposerNationality($: CheerioDocument): string | null {
  const sources = [
    $('.cp_firsth').text(),
    extractComposerCategories($),
    extractExternalLinks($),
  ];

  for (const source of sources) {
    const found = source ? findNationalityByText(source) : null;

    if (found) {
      return found;
    }
  }

  return null;
}

const MONTHS: Record<string, string> = {
  janeiro: '01',
  jan: '01',
  fevereiro: '02',
  fev: '02',
  março: '03',
  mar: '03',
  abril: '04',
  abr: '04',
  maio: '05',
  mai: '05',
  junho: '06',
  jun: '06',
  julho: '07',
  jul: '07',
  agosto: '08',
  ago: '08',
  setembro: '09',
  set: '09',
  outubro: '10',
  out: '10',
  novembro: '11',
  nov: '11',
  dezembro: '12',
  dez: '12',
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

const DAY_BEFORE_MONTH = new RegExp(
  `(\\d{1,2})\\s+(?:de\\s+)?(${Object.keys(MONTHS).join('|')})`,
  'i',
);

/**
 * Converte um pedaço de texto do IMSLP numa data.
 *
 * **Devolve só o que a página disse.** O legado completava o que faltava com
 * `01`: um compositor de quem se sabe apenas o ano de nascimento saía com
 * `"1797-01-01"`, e essa data falsa ia para o catálogo e para a tela como
 * "1 de janeiro de 1797". Aqui a precisão é preservada — `"1797"` quando é só o
 * ano, `"1797-01"` quando há mês sem dia — pela mesma razão que a leitura na
 * Wikipedia respeita a precisão declarada pelo Wikidata.
 */
export function parseFlexibleDate(dateString: string | null): string | null {
  if (!dateString) {
    return null;
  }

  const year = dateString.match(/(\d{4})/)?.[1];

  if (!year) {
    return null;
  }

  const monthName = Object.keys(MONTHS).find((name) =>
    dateString.toLowerCase().includes(name),
  );

  if (!monthName) {
    return year;
  }

  const month = MONTHS[monthName];
  const day = Number(dateString.match(DAY_BEFORE_MONTH)?.[1]);

  if (!day || day < 1 || day > 31) {
    return `${year}-${month}`;
  }

  return `${year}-${month}-${String(day).padStart(2, '0')}`;
}

/** Os padrões de data no cabeçalho, na ordem em que o legado os testava. */
const DATE_PATTERNS = [
  // (31 January 1797 – 28 November 1828)
  /\(([^)]+)\s*[–—-]\s*([^)]+)\)/,
  // (born 1797, died 1828)
  /\(.*?born.*?(\d{4}).*?died.*?(\d{4})\)/i,
  // (1797-1828)
  /\((\d{4})\s*[–—-]\s*(\d{4})\)/,
  // (Berlin, 31 January 1797 – Vienna, 28 November 1828)
  /\(([^,]*,?\s*[^)]*?)\s*[–—-]\s*([^)]*)\)/,
];

/**
 * Nascimento e morte, do cabeçalho da página.
 *
 * O local vem colado na data — "Berlin, 31 January 1797" — e sai antes da
 * conversão.
 *
 * **O compositor vivo não ganha data de morte.** Quando o cabeçalho traz só uma
 * data, o legado caía num `/\(.*?(\d{4})/` que pegava o primeiro ano dentro de
 * qualquer parêntese da página e o gravava como nascimento — mesmo que aquele
 * parêntese fosse outra coisa. Aqui a reserva exige que o ano venha do trecho
 * de datas, e a morte fica nula.
 */
export function extractComposerDates($: CheerioDocument): {
  birthDate: string | null;
  deathDate: string | null;
} {
  const firsth = $('.cp_firsth');

  if (firsth.length === 0) {
    return { birthDate: null, deathDate: null };
  }

  const text = firsth.text();

  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern);
    const birth = match?.[1]?.trim();
    const death = match?.[2]?.trim();

    if (birth && death) {
      return {
        birthDate: parseFlexibleDate(stripPlace(birth)),
        deathDate: parseFlexibleDate(stripPlace(death)),
      };
    }
  }

  // Só o nascimento: compositor vivo, ou página que não diz a morte.
  const alone = text.match(/\(([^)]*\d{4}[^)]*)\)/)?.[1];

  return {
    birthDate: alone ? parseFlexibleDate(stripPlace(alone)) : null,
    deathDate: null,
  };
}

/** Tira o local que vem antes da data ("Berlin, 31 January 1797"). */
function stripPlace(value: string): string {
  return value.replace(/^[^,]+,\s*/, '').trim();
}
