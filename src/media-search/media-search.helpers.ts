type WorkWithRelations = {
  id: string;
  title: string;
  workType: string;
  movementNumber: number | null;
  opOrCatalog: string | null;
  tone: string | null;
  moviment: string | null;
  workGenresArr: string[];
  composer: {
    fullName: string;
  };
  instrument: {
    name: string;
  } | null;
};

export function isValidForAutoSearch(work: WorkWithRelations): boolean {
  const title = work.title.toLowerCase();

  const excludeKeywords = [
    'complete works',
    'collected works',
    'anthology',
    'collection',
    'album',
    'book',
    'volume',
    'vol.',
    'études',
    'etudes',
    'studies',
    'exercises',
    'method',
    'school',
    'tutorial',
    'course',
    'manuscript',
    'autograph',
    'sketches',
    'fragments',
  ];

  if (excludeKeywords.some((keyword) => title.includes(keyword))) {
    return false;
  }

  if (
    work.workType === 'COLLECTED_WORKS' &&
    work.movementNumber &&
    work.movementNumber > 8
  ) {
    return false;
  }

  return work.title.trim().length >= 3;
}

export function generateSimpleQuery(work: WorkWithRelations): string {
  return `${cleanTitle(work.title)} - ${work.composer.fullName}`;
}

export function isValidClassicalResult(title: string, artist: string): boolean {
  const combined = `${title} ${artist}`.toLowerCase();

  const excludeKeywords = [
    'remix',
    'electronic',
    'jazz version',
    'rock version',
    'pop version',
    'hip hop',
    'rap',
    'disco',
    'funk',
    'metal',
    'karaoke',
    'backing track',
    'play along',
    'tutorial',
    'lesson',
    'how to',
    'reaction',
    'review',
  ];

  if (excludeKeywords.some((keyword) => combined.includes(keyword))) {
    return false;
  }

  const classicalKeywords = [
    'classical',
    'piano',
    'violin',
    'orchestra',
    'symphony',
    'philharmonic',
    'chamber',
    'quartet',
    'sonata',
    'concerto',
    'opus',
    'op.',
    'bwv',
    'ensemble',
    'conservatory',
    'recital',
  ];

  return classicalKeywords.some((keyword) => combined.includes(keyword));
}

export function isValidMusicVideo(title: string): boolean {
  const normalizedTitle = title.toLowerCase();
  const excludeKeywords = [
    'tutorial',
    'lesson',
    'how to',
    'how-to',
    'analysis',
    'review',
    'reaction',
    'interview',
    'documentary',
    'behind the scenes',
    'making of',
    'masterclass',
    'course',
    'lecture',
    'talk',
    'discussion',
    'podcast',
    'vlog',
    'unboxing',
    'gear review',
  ];

  return !excludeKeywords.some((keyword) => normalizedTitle.includes(keyword));
}

function cleanTitle(title: string): string {
  return title
    .replace(/,?\s*(Op\.|BWV|K\.|Hob\.|D\.|CD|L\.)\s*[\d\w\-\/\.]+/gi, '')
    .replace(/\s*[\(\[\{][^\)\]\}]*[\)\]\}]/g, '')
    .replace(/["']/g, '')
    .replace(/[,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
