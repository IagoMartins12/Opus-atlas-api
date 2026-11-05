/**
 * Relevância de uma obra para um termo de busca: o que a pessoa procurou
 * vem antes de tudo o que só tem uma palavra em comum.
 *
 * **Por que não basta o `textScore`.** O `$text` do MongoDB junta as palavras
 * com OU: "sonata ao luar" casa as 9.728 obras com "sonata" no título. O
 * `textScore` mede quantas vezes cada palavra aparece e com que peso, mas
 * não sabe se a frase está ali inteira nem se a obra é a que todo mundo
 * conhece. E o catálogo nem usava o `textScore`: ordenava as 9.728 de A a Z.
 *
 * A nota soma, do sinal mais forte ao mais fraco:
 * - **nome igual ao termo** — título, nome popular ou parte famosa ("Clair
 *   de lune", "Para Elisa");
 * - **frase inteira contida**, na ordem, com qualquer pontuação entre as
 *   palavras ("op 27" acha "Op.27 No.2");
 * - **quantas palavras do termo a obra cobre**, contando o compositor
 *   ("chopin nocturne": o noturno de Chopin cobre as duas, o "Nocturne" de
 *   outro só uma);
 * - **compositor** que casa com o termo;
 * - o **destaque** da obra (`work-prominence.ts`): entre as que casam igual,
 *   a conhecida primeiro;
 * - o **`textScore`**, que desempata pelo peso dos campos.
 *
 * Acento não conta, nem maiúscula: "fur elise" acha "Für Elise", "estacoes"
 * acha "Estações".
 */

/** Palavras que não distinguem uma obra de outra, nas línguas do acervo. */
const STOPWORDS = new Set([
  // pt
  'a',
  'o',
  'as',
  'os',
  'ao',
  'aos',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'em',
  'na',
  'no',
  'nas',
  'nos',
  'para',
  'por',
  'com',
  'um',
  'uma',
  // en
  'the',
  'of',
  'and',
  'for',
  'in',
  'on',
  'an',
  'to',
  // fr / it / es / de
  'la',
  'le',
  'les',
  'des',
  'du',
  'et',
  'il',
  'lo',
  'gli',
  'di',
  'del',
  'della',
  'el',
  'y',
  'der',
  'die',
  'das',
  'und',
  'im',
  'zu',
]);

/** Termo longo não vira dezenas de expressões por obra. */
const MAX_TOKENS = 8;

/** Uma letra sem acento → a classe com as variantes com acento, nas duas caixas. */
const ACCENTS: Record<string, string> = {
  a: 'aàáâãäåAÀÁÂÃÄÅ',
  e: 'eèéêëEÈÉÊË',
  i: 'iìíîïIÌÍÎÏ',
  o: 'oòóôõöøOÒÓÔÕÖØ',
  u: 'uùúûüUÙÚÛÜ',
  c: 'cçCÇ',
  n: 'nñNÑ',
  y: 'yýÿYÝŸ',
};

export const RELEVANCE_WEIGHTS = {
  exact: 40,
  phrase: 25,
  coverage: 20,
  composer: 10,
  /** O destaque vai de 0 a 1000: até +20. */
  prominence: 0.02,
} as const;

/** Sem acento, minúsculo, em palavras. */
export function searchTokens(term: string): string[] {
  return term
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, MAX_TOKENS);
}

/** As palavras que distinguem; se o termo for só delas ("a la"), todas. */
export function significantTokens(tokens: string[]): string[] {
  const significant = tokens.filter((token) => !STOPWORDS.has(token));
  return significant.length > 0 ? significant : tokens;
}

/** Uma palavra como expressão que aceita acento e maiúscula. */
export function accentPattern(token: string): string {
  return [...token]
    .map((char) => {
      const lower = char.toLowerCase();
      if (ACCENTS[lower]) return `[${ACCENTS[lower]}]`;
      if (/[\p{L}\p{N}]/u.test(char)) {
        const upper = char.toUpperCase();
        // "ß" vira "SS": sem par de uma letra, fica como está.
        return upper === lower || upper.length !== 1
          ? char
          : `[${lower}${upper}]`;
      }
      return `\\${char}`;
    })
    .join('');
}

/** Entre as palavras da frase: espaço, ponto, vírgula, hífen, apóstrofo… */
const GAP = `[^0-9A-Za-zÀ-ÖØ-öø-ÿ]*`;
/** Começo de palavra, sem `\b` (que não reconhece letra acentuada). */
const WORD_START = `(?:^|[^0-9A-Za-zÀ-ÖØ-öø-ÿ])`;

export function phrasePattern(tokens: string[]): string {
  return tokens.map(accentPattern).join(GAP);
}

export interface RelevanceInput {
  term: string;
  /**
   * Quantas palavras significativas do termo o nome de cada compositor cobre
   * (só os que cobrem alguma). Calculado fora, sobre os nomes já lidos.
   */
  composerCoverage: Map<string, number>;
}

const field = (name: string) => ({ $ifNull: [`$${name}`, ''] });
const joined = (name: string) => ({
  $reduce: {
    input: { $ifNull: [`$${name}`, []] },
    initialValue: '',
    in: { $concat: ['$$value', ' ', '$$this'] },
  },
});

/** Os campos que o estágio de nota lê: o `$project` dos dois ramos. */
export const RELEVANCE_FIELDS = {
  title: 1,
  popularName: 1,
  popularNameEn: 1,
  famousParts: 1,
  famousPartsEn: 1,
  opOrCatalog: 1,
  subtitle: 1,
  prominence: 1,
  composerId: 1,
} as const;

/**
 * O estágio que grava a nota em `_score`. Espera os campos de
 * `RELEVANCE_FIELDS` e o `textScore` em `_ts` (0 na obra que veio só pelo
 * compositor).
 */
export function relevanceStages(
  input: RelevanceInput,
): Record<string, unknown>[] {
  const tokens = searchTokens(input.term);
  if (tokens.length === 0) {
    return [{ $addFields: { _score: { $ifNull: ['$_ts', 0] } } }];
  }
  const significant = significantTokens(tokens);
  const phrase = phrasePattern(tokens);
  // Igual, ou igual seguido do complemento: "Für Elise, WoO 59" e "Clair de
  // Lune (3º movimento)" são o nome procurado, não uma obra que o contém.
  const exact = `^\\s*${phrase}\\s*(?:[,(:;/–—-].*)?$`;
  const matches = (input: unknown, regex: string) => ({
    $regexMatch: { input, regex, options: 'i' },
  });
  const anyMatches = (name: string, regex: string) => ({
    $anyElementTrue: [
      {
        $map: {
          input: { $ifNull: [`$${name}`, []] },
          as: 'part',
          in: matches('$$part', regex),
        },
      },
    ],
  });

  // Compositores agrupados por quantas palavras cobrem: um `$switch` curto.
  const byCoverage = new Map<number, string[]>();
  for (const [id, covered] of input.composerCoverage) {
    const ids = byCoverage.get(covered) ?? [];
    ids.push(id);
    byCoverage.set(covered, ids);
  }
  const composerCovered =
    byCoverage.size === 0
      ? 0
      : {
          $switch: {
            branches: [...byCoverage].map(([covered, ids]) => ({
              case: {
                $in: ['$composerId', ids.map((id) => ({ $oid: id }))],
              },
              then: covered,
            })),
            default: 0,
          },
        };

  return [
    {
      $addFields: {
        _text: {
          $concat: [
            ' ',
            field('title'),
            ' ',
            field('popularName'),
            ' ',
            field('popularNameEn'),
            ' ',
            field('subtitle'),
            ' ',
            field('opOrCatalog'),
            joined('famousParts'),
            joined('famousPartsEn'),
          ],
        },
        _composer: composerCovered,
      },
    },
    {
      $addFields: {
        _exact: {
          $or: [
            matches(field('title'), exact),
            matches(field('popularName'), exact),
            matches(field('popularNameEn'), exact),
            anyMatches('famousParts', exact),
            anyMatches('famousPartsEn', exact),
          ],
        },
        _phrase: matches('$_text', phrase),
        _covered: {
          $add: significant.map((token) => ({
            $cond: [
              matches('$_text', `${WORD_START}${accentPattern(token)}`),
              1,
              0,
            ],
          })),
        },
      },
    },
    {
      $addFields: {
        _score: {
          $add: [
            { $ifNull: ['$_ts', 0] },
            { $cond: ['$_exact', RELEVANCE_WEIGHTS.exact, 0] },
            { $cond: ['$_phrase', RELEVANCE_WEIGHTS.phrase, 0] },
            {
              $multiply: [
                RELEVANCE_WEIGHTS.coverage,
                {
                  $min: [
                    1,
                    {
                      $divide: [
                        { $add: ['$_covered', '$_composer'] },
                        significant.length,
                      ],
                    },
                  ],
                },
              ],
            },
            {
              $cond: [
                { $gt: ['$_composer', 0] },
                RELEVANCE_WEIGHTS.composer,
                0,
              ],
            },
            {
              $multiply: [
                { $ifNull: ['$prominence', 0] },
                RELEVANCE_WEIGHTS.prominence,
              ],
            },
          ],
        },
      },
    },
  ];
}

/**
 * Quantas palavras significativas do termo cada nome de compositor cobre.
 * Só entram os que cobrem alguma: o índice de texto do compositor também
 * casa por OU, e "sonata ao luar" não é busca por um compositor chamado Luar.
 */
export function composerCoverage(
  term: string,
  composers: Array<{
    id: string;
    name: string | null;
    fullName: string | null;
  }>,
): Map<string, number> {
  const significant = significantTokens(searchTokens(term));
  const coverage = new Map<string, number>();
  for (const composer of composers) {
    const words = new Set(
      searchTokens(`${composer.name ?? ''} ${composer.fullName ?? ''}`),
    );
    const covered = significant.filter((token) =>
      [...words].some((word) => word.startsWith(token)),
    ).length;
    if (covered > 0) coverage.set(composer.id, covered);
  }
  return coverage;
}
