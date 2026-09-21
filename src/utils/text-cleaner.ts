import { EventType } from '@prisma/client';

// scripts/utils/text-cleaner.ts

/**
 * Remove tags HTML e limpa texto
 */
export function cleanHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '') // Remove tags HTML
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ') // Múltiplos espaços -> um espaço
    .trim();
}

/**
 * Extrai apenas o primeiro parágrafo significativo
 */
export function extractFirstParagraph(text: string): string {
  const paragraphs = text.split('\n').filter((p) => p.trim().length > 50);
  return paragraphs[0] || text.substring(0, 300);
}

/**
 * Detecta tipo de evento baseado no título/descrição
 */
export function detectEventType(title: string, description: string): EventType {
  const combined = `${title} ${description}`.toLowerCase();

  // 1. Ópera (prioridade alta)
  if (
    combined.includes('ópera na sala') ||
    combined.includes('wozzeck') ||
    combined.includes('opera completa')
  ) {
    return EventType.OPERA;
  }

  // 2. Recital (prioridade alta)
  if (
    combined.includes('recital:') ||
    combined.includes('recital de') ||
    title.toLowerCase().startsWith('recital')
  ) {
    return EventType.RECITAL;
  }

  // 3. Ensaio aberto
  if (
    combined.includes('ensaio aberto') ||
    combined.includes('ensaio público')
  ) {
    return EventType.OPEN_REHEARSAL;
  }

  // 4. Coro
  if (
    combined.includes('coro da osesp') ||
    combined.includes('coral paulistano') ||
    title.toLowerCase().includes('coro')
  ) {
    return EventType.CHOIR;
  }

  // 5. Música de câmara
  if (combined.includes('câmara:') || combined.includes('camera:')) {
    return EventType.CHAMBER_MUSIC;
  }

  // 6. Matinais (são concertos educativos)
  if (combined.includes('matinais:') || combined.includes('matinal')) {
    // `MATINEE` nao existe no enum `EventType` do schema — gravar esse valor
    // quebrava a escrita no Prisma. Mapeado para CONCERT conforme o comentario
    // original do branch ("sao concertos educativos").
    return EventType.CONCERT;
  }

  // 7. Osesp duas e trinta (concertos especiais)
  if (combined.includes('osesp duas e trinta')) {
    return EventType.CONCERT;
  }

  // 8. Default: Concert
  return EventType.CONCERT;
}
/**
 * Extrai nomes de compositores conhecidos do texto
 */
export function extractComposerNames(text: string): string[] {
  const composerPatterns = [
    'Beethoven',
    'Mozart',
    'Bach',
    'Wagner',
    'Haydn',
    'Brahms',
    'Schubert',
    'Tchaikovsky',
    'Handel',
    'Stravinsky',
    'Schumann',
    'Mendelssohn',
    'Debussy',
    'Mahler',
    'Liszt',
    'Ravel',
    'Dvořák',
    'Vivaldi',
    'Shostakovich',
    'Chopin',
    'Prokofiev',
    'Bartók',
    'Berlioz',
    'Bruckner',
    'Palestrina',
    'Monteverdi',
    'Sibelius',
    'Mussorgsky',
    'Puccini',
    'Purcell',
    'Rossini',
    'Elgar',
    'Rachmaninoff',
    'Saint-Saëns',
    'Bizet',
    'Scarlatti',
    'Telemann',
    'Webern',
    'Gershwin',
    'Donizetti',
    'Corelli',
    'Tallis',
    'Janácek',
    'Berg',
    'Borodin',
    'Bellini',
    'Gounod',
    'Massenet',
    'Poulenc',
    'Gabrieli',
    'Schütz',
    'Cage',
    'Pergolesi',
    'Dowland',
    'Holst',
    'Buxtehude',
    'Respighi',
    'Dufay',
    'Wolf',
    'Nielsen',
    'Walton',
    'Milhaud',
    'Gibbons',
    'Meyerbeer',
    'Barber',
    'Falla',
    'Glinka',
    'Glazunov',
    'Gesualdo',
    'Scriabin',
    'Bruch',
    'Franck',
    'Fauré',
    'Grieg',
    'Gluck',
    'Schoenberg',
    'Ives',
    'Hindemith',
    'Messiaen',
    'Copland',
    'Couperin',
    'Byrd',
    'Satie',
    'Britten',
    'Smetana',
    'Lassus',
    'Strauss',
    'Rimsky-Korsakov',
    'Weber',
    'Rameau',
    'Lully',
    'Villa-Lobos',
    'Guarnieri',
    'Mignone',
    'Marlos Nobre',
    'Santoro',
    'Nepomuceno',
    'Carlos Gomes',
    'Josquin',
    'Pérotin',
    'Léonin',
    'Machaut',
    'Victoria',
    'Hildegard',
    'Braga', // Francisco Braga (compositor brasileiro)
  ];

  // ✅ BLACKLIST: Nomes que NÃO são compositores
  const blacklist = [
    'Wagner Polistchuk', // Diretor musical
    'Thierry Fischer', // Regente
    'Jorge Coli', // Palestrante
    'Christian Dunker', // Psicanalista
    'Vladimir Safatle', // Filósofo
  ];

  const found: string[] = [];

  composerPatterns.forEach((composer) => {
    // ✅ Verifica se está na blacklist
    const isBlacklisted = blacklist.some(
      (blocked) => text.includes(blocked) && blocked.includes(composer),
    );

    if (isBlacklisted) {
      return; // Pula este compositor
    }

    const patterns = [
      // "COMPOSITOR Sinfonia/Concerto/Opus"
      new RegExp(
        `\\b${composer}\\s+(?:Sinfonia|Concerto|Sonata|Opus|Op\\.|Fantasia|Prelúdio|Messa|Quarteto)`,
        'i',
      ),

      // Nome completo em MAIÚSCULAS no programa (ex: "PIOTR ILITCH TCHAIKOVSKY")
      new RegExp(`\\b[A-Z][A-Z\\s]+${composer.toUpperCase()}\\b`),

      // "de Alban Berg" ou "por COMPOSITOR"
      new RegExp(`(?:de|por)\\s+(?:[A-Z]\\w+\\s+)*${composer}`, 'i'),

      // ✅ NOVO: Busca no início de linha (comum em programas)
      new RegExp(`^${composer}\\s+[A-Z]`, 'im'),
    ];

    const matchesPattern = patterns.some((pattern) => pattern.test(text));

    if (matchesPattern && !found.includes(composer)) {
      found.push(composer);
    }
  });

  return found;
}
