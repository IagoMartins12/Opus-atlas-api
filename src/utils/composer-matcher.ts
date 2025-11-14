// scripts/utils/composer-matcher.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ComposerCache {
  id: string;
  name: string;
  fullName: string;
  normalizedName: string;
  normalizedFullName: string;
  alternativeNames: string[];
  isFamous: boolean; // ✅ NOVO: marca compositores famosos
}

let composerCache: ComposerCache[] | null = null;

/**
 * ✅ NOVA FUNÇÃO: Retorna lista de compositores famosos do seu sistema
 */
async function getFamousComposerNames(): Promise<string[]> {
  const famousComposers = [
    // Top 20
    'Ludwig van Beethoven',
    'Wolfgang Amadeus Mozart',
    'Johann Sebastian Bach',
    'Richard Wagner',
    'Joseph Haydn',
    'Johannes Brahms',
    'Franz Schubert',
    'Peter Ilyich Tchaikovsky',
    'George Frideric Handel',
    'Igor Stravinsky',
    'Robert Schumann',
    'Felix Mendelssohn',
    'Claude Debussy',
    'Gustav Mahler',
    'Franz Liszt',
    'Maurice Ravel',
    'Antonín Dvořák',
    'Antonio Vivaldi',
    'Dmitri Shostakovich',
    'Steve Reich',
    'Frédéric Chopin',

    // Recomendados
    'Serge Prokofiev',
    'Béla Bartók',
    'Hector Berlioz',
    'Anton Bruckner',
    'Giovanni Pierluigi da Palestrina',
    'Claudio Monteverdi',
    'Jean Sibelius',
    'Ralph Vaughan Williams',
    'Modest Mussorgsky',
    'Giacomo Puccini',
    'Henry Purcell',
    'Gioacchino Rossini',
    'Edward Elgar',
    'Sergei Rachmaninoff',
    'Camille Saint-Saëns',
    'Josquin Des Prez',
    'Nikolai Rimsky-Korsakov',
    'Carl Maria von Weber',
    'Jean-Philippe Rameau',
    'Jean-Baptiste Lully',
    'Gabriel Fauré',
    'Edvard Grieg',
    'Christoph Willibald Gluck',
    'Arnold Schoenberg',
    'Charles Ives',
    'Paul Hindemith',
    'Olivier Messiaen',
    'Aaron Copland',
    'Francois Couperin',
    'William Byrd',
    'Erik Satie',
    'Benjamin Britten',
    'Bedrick Smetana',
    'César Franck',
    'Alexander Nikolayevich Scriabin',
    'Georges Bizet',
    'Domenico Scarlatti',
    'Georg Philipp Telemann',
    'Anton Webern',
    'Roland de Lassus',
    'George Gershwin',
    'Gaetano Donizetti',
    'Carl Philipp Emanuel Bach',
    'Archangelo Corelli',
    'Thomas Tallis',
    'Johann Strauss II',
    'Leos Janácek',
    'Guillaume de Machaut',
    'Alban Berg',
    'Alexander Borodin',
    'Vincenzo Bellini',
    'Charles Gounod',
    'Jules Massenet',
    'Francis Poulenc',
    'Giovanni Gabrieli',
    'Pérotin',
    'Heinrich Schütz',
    'John Cage',
    'Giovanni Battista Pergolesi',
    'John Dowland',
    'Gustav Holst',
    'Dietrich Buxtehude',
    'Ottorino Respighi',
    'Guillaume Dufay',
    'Hugo Wolf',
    'Carl Nielsen',
    'William Walton',
    'Darius Milhaud',
    'Orlando Gibbons',
    'Giacomo Meyerbeer',
    'Samuel Barber',
    'Tomás Luis de Victoria',
    'Léonin',
    'Manuel de Falla',
    'Hildegard von Bingen',
    'Mikhail Glinka',
    'Alexander Glazunov',
    'Don Carlo Gesualdo',

    // ✅ Compositores Brasileiros (adicione mais conforme necessário)
    'Heitor Villa-Lobos',
    'Camargo Guarnieri',
    'Francisco Mignone',
    'Marlos Nobre',
    'Claudio Santoro',
    'Alberto Nepomuceno',
    'Carlos Gomes',
  ];

  return famousComposers;
}

/**
 * Carrega compositores com prioridade para os famosos
 */
export async function loadComposerCache(): Promise<void> {
  if (composerCache !== null) return;

  console.log('🔄 Loading composer cache...');
  const startTime = Date.now();

  try {
    const famousNames = await getFamousComposerNames();

    // ✅ OTIMIZAÇÃO: Carrega compositores famosos primeiro
    const famousComposers = await prisma.composer.findMany({
      where: {
        fullName: {
          in: famousNames,
        },
      },
      select: {
        id: true,
        name: true,
        fullName: true,
        alternativeNames: true,
      },
    });

    // ✅ Carrega outros compositores (limit opcional para performance)
    const otherComposers = await prisma.composer.findMany({
      where: {
        fullName: {
          notIn: famousNames,
        },
        // ✅ OPCIONAL: filtra apenas compositores (não performers)
        OR: [
          { primaryRoleId: '685d591c1e3db0c5aaa893e4' },
          { roles: { contains: '685d591c1e3db0c5aaa893e4' } },
        ],
      },
      select: {
        id: true,
        name: true,
        fullName: true,
        alternativeNames: true,
      },
      // ✅ OPCIONAL: limita para não sobrecarregar memória
      // take: 5000, // Descomente se tiver problemas de memória
    });

    // Combina todos os compositores
    const allComposers = [...famousComposers, ...otherComposers];

    composerCache = allComposers.map((c) => {
      let alternatives: string[] = [];

      if (c.alternativeNames) {
        try {
          alternatives = JSON.parse(c.alternativeNames);
        } catch {
          if (typeof c.alternativeNames === 'string') {
            alternatives = c.alternativeNames
              .split(/[;,\n]/)
              .map((name) => name.trim())
              .filter((name) => name.length > 0);
          }
        }
      }

      return {
        id: c.id,
        name: c.name,
        fullName: c.fullName || c.name,
        normalizedName: normalizeForMatching(c.name),
        normalizedFullName: normalizeForMatching(c.fullName || c.name),
        alternativeNames: Array.isArray(alternatives) ? alternatives : [],
        isFamous: famousNames.includes(c.fullName || ''), // ✅ Marca famosos
      };
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const famousCount = composerCache.filter((c) => c.isFamous).length;

    console.log(`✅ Loaded ${composerCache.length} composers in ${elapsed}s`);
    console.log(
      `   Famous: ${famousCount}, Others: ${composerCache.length - famousCount}`,
    );

    const memUsage = process.memoryUsage();
    console.log(
      `   Memory: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
    );
  } catch (error: any) {
    console.error('❌ Error loading composer cache:', error.message);
    composerCache = [];
    throw error;
  }
}

/**
 * Normaliza texto para matching
 */
function normalizeForMatching(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .trim();
}

/**
 * ✅ MELHORADO: Busca compositores com prioridade para famosos
 */
export async function findComposerByName(name: string): Promise<string | null> {
  if (!composerCache) {
    await loadComposerCache();
  }

  if (!composerCache || composerCache.length === 0) {
    return null;
  }

  const normalized = normalizeForMatching(name);

  // ✅ PRIORIDADE 1: Busca exata em compositores FAMOSOS
  const exactFamousMatch = composerCache.find(
    (c) => c.isFamous && c.normalizedName === normalized,
  );
  if (exactFamousMatch) {
    console.log(`   🌟 Famous match: "${name}" -> "${exactFamousMatch.name}"`);
    return exactFamousMatch.id;
  }

  // ✅ PRIORIDADE 2: Busca por fullName em compositores FAMOSOS
  const fullNameFamousMatch = composerCache.find(
    (c) => c.isFamous && c.normalizedFullName === normalized,
  );
  if (fullNameFamousMatch) {
    console.log(
      `   🌟 Famous match: "${name}" -> "${fullNameFamousMatch.fullName}"`,
    );
    return fullNameFamousMatch.id;
  }

  // 3. Busca exata em todos os compositores
  const exactMatch = composerCache.find(
    (c) =>
      c.normalizedName === normalized || c.normalizedFullName === normalized,
  );
  if (exactMatch) return exactMatch.id;

  // 4. Busca por substring (contém)
  const substringMatch = composerCache.find(
    (c) =>
      c.normalizedName.includes(normalized) ||
      normalized.includes(c.normalizedName) ||
      c.normalizedFullName.includes(normalized) ||
      normalized.includes(c.normalizedFullName),
  );
  if (substringMatch) return substringMatch.id;

  // 5. Busca em nomes alternativos
  const alternativeMatch = composerCache.find((c) =>
    c.alternativeNames.some((alt) => normalizeForMatching(alt) === normalized),
  );
  if (alternativeMatch) return alternativeMatch.id;

  // 6. Fuzzy matching (apenas para compositores famosos - performance)
  const famousComposers = composerCache.filter((c) => c.isFamous);

  let bestMatch: ComposerCache | any | null = null;
  let bestScore = 0;

  famousComposers.forEach((c) => {
    const scoreByName = jaroWinklerSimilarity(c.normalizedName, normalized);
    const scoreByFullName = jaroWinklerSimilarity(
      c.normalizedFullName,
      normalized,
    );
    const score = Math.max(scoreByName, scoreByFullName);

    if (score > bestScore && score > 0.85) {
      bestScore = score;
      bestMatch = c;
    }
  });

  if (bestMatch) {
    console.log(
      `   🔍 Fuzzy match: "${name}" -> "${bestMatch.name}" (${(bestScore * 100).toFixed(1)}%)`,
    );
    return bestMatch.id;
  }

  return null;
}

/**
 * Calcula similaridade Jaro-Winkler
 */
function jaroWinklerSimilarity(s1: string, s2: string): number {
  const m1 = s1.length;
  const m2 = s2.length;

  if (m1 === 0 && m2 === 0) return 1;
  if (m1 === 0 || m2 === 0) return 0;

  const matchDistance = Math.floor(Math.max(m1, m2) / 2) - 1;
  const s1Matches = new Array(m1).fill(false);
  const s2Matches = new Array(m2).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < m1; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, m2);

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < m1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / m1 + matches / m2 + (matches - transpositions / 2) / matches) /
    3;

  let prefix = 0;
  for (let i = 0; i < Math.min(m1, m2, 4); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Busca múltiplos compositores
 */
export async function findMultipleComposers(
  names: string[],
): Promise<string[]> {
  if (!composerCache) {
    await loadComposerCache();
  }

  const composerIds: string[] = [];
  const uniqueNames = [...new Set(names)];

  for (const name of uniqueNames) {
    const id = await findComposerByName(name);
    if (id && !composerIds.includes(id)) {
      composerIds.push(id);
    }
  }

  return composerIds;
}

/**
 * Limpa cache
 */
export function clearComposerCache(): void {
  composerCache = null;
  console.log('🗑️  Composer cache cleared');
}
