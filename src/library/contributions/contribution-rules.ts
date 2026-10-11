import { ContributionKind } from '@prisma/client';

export type ContributableEntity = 'composer' | 'work';

/**
 * One field anyone with a verified email may change on a record they did
 * not create. `normalize` trims and canonicalizes; it returns null when the
 * value is not acceptable, with the reason in `hint`.
 */
interface FieldRule {
  kind: ContributionKind;
  normalize: (value: string) => string | null;
  hint: string;
}

const YOUTUBE_ID =
  /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([\w-]{11})/i;

/** Any YouTube link, stored as the plain watch URL. */
export function canonicalYoutubeUrl(value: string): string | null {
  const id = value.match(YOUTUBE_ID)?.[1];
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

const text =
  (min: number, max: number) =>
  (value: string): string | null => {
    const clean = value.trim().replace(/\s+\n/g, '\n');
    return clean.length >= min && clean.length <= max ? clean : null;
  };

const bio: FieldRule = {
  kind: ContributionKind.BIO,
  // A biography is a text, not a line: short replacements are vandalism
  // more often than improvement.
  normalize: text(300, 12_000),
  hint: 'A biografia precisa ter entre 300 e 12.000 caracteres.',
};

const video: FieldRule = {
  kind: ContributionKind.VIDEO,
  normalize: canonicalYoutubeUrl,
  hint: 'Envie um link do YouTube.',
};

const short = (max: number): FieldRule => ({
  kind: ContributionKind.CORRECTION,
  normalize: text(1, max),
  hint: `Use até ${max} caracteres.`,
});

const wikipedia: FieldRule = {
  kind: ContributionKind.CORRECTION,
  normalize: (value) => {
    const clean = value.trim();
    return /^https:\/\/([a-z-]+\.)?(m\.)?wikipedia\.org\/wiki\/\S+$/i.test(
      clean,
    )
      ? clean
      : null;
  },
  hint: 'Envie um link de um artigo da Wikipédia.',
};

/**
 * What each record accepts. Identity fields (names, titles, catalog ids,
 * IMSLP links) stay out on purpose: changing them moves the record, and
 * that is still the owner's or the team's call.
 */
export const CONTRIBUTABLE_FIELDS: Record<
  ContributableEntity,
  Record<string, FieldRule>
> = {
  composer: {
    bio,
    bioEn: bio,
    videoUrl: video,
    birthDate: short(60),
    deathDate: short(60),
    nationality: short(60),
    wikipediaLink: wikipedia,
  },
  work: {
    compositionYear: short(40),
    firstPublishDate: short(40),
    tone: short(40),
    dedicateTo: short(200),
    instrumentation: short(300),
    subtitle: short(200),
  },
};

export function fieldRule(
  entityType: ContributableEntity,
  field: string,
): FieldRule | null {
  return Object.prototype.hasOwnProperty.call(
    CONTRIBUTABLE_FIELDS[entityType],
    field,
  )
    ? CONTRIBUTABLE_FIELDS[entityType][field]
    : null;
}

/** XP per kind: the effort it takes, not how often it happens. */
export const XP_BY_KIND: Record<ContributionKind, number> = {
  BIO: 120,
  VIDEO: 40,
  CURIOSITY: 30,
  CORRECTION: 20,
};

/**
 * The XP arrives this many days later, if no report against it was upheld
 * (decided by the owner in the sketches, 06/10): it takes the race out of
 * posting poor content for points.
 */
export const XP_WAIT_DAYS = 7;

/**
 * Contributions beyond this count in a day still go live, but earn no XP.
 * XP is a thank-you, and a thank-you that can be farmed stops meaning one.
 */
export const DAILY_XP_CONTRIBUTIONS = 10;
