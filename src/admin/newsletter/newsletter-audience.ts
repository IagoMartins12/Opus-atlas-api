import { DifficultyLevel, Prisma, SubscriptionStatus } from '@prisma/client';

/**
 * Critérios de segmentação de uma campanha.
 *
 * Existe porque o legado fazia isto:
 *
 * ```js
 * where: {
 *   status: 'ACTIVE',
 *   ...(campaign.targetSegments ? JSON.parse(campaign.targetSegments) : {}),
 * }
 * ```
 *
 * `targetSegments` é uma coluna `Json`, então o Prisma já devolve um objeto —
 * `JSON.parse` de objeto lança. E se o valor fosse texto, qualquer JSON que um
 * administrador tivesse salvo entraria **cru no `where` do Prisma**, decidindo
 * quem recebe o e-mail. Aqui os critérios têm forma conhecida e são traduzidos
 * para o filtro por código nosso.
 */
export interface AudienceSegments {
  interests?: string[];
  favoriteInstruments?: string[];
  favoriteEpochs?: string[];
  experienceLevel?: DifficultyLevel;
  frequency?: string;
  language?: string;
  /** Só quem abriu algum e-mail desde esta data. */
  engagedSince?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/**
 * Lê os critérios guardados, descartando o que não reconhece.
 *
 * Nunca lança: uma campanha com segmentação estranha no banco precisa poder ser
 * aberta e corrigida, não derrubar a listagem.
 */
export function readSegments(value: unknown): AudienceSegments {
  if (!isRecord(value)) {
    return {};
  }

  const level = asString(value.experienceLevel);

  return {
    interests: asStringArray(value.interests),
    favoriteInstruments: asStringArray(value.favoriteInstruments),
    favoriteEpochs: asStringArray(value.favoriteEpochs),
    experienceLevel:
      level && level in DifficultyLevel
        ? (level as DifficultyLevel)
        : undefined,
    frequency: asString(value.frequency),
    language: asString(value.language),
    engagedSince: asString(value.engagedSince),
  };
}

/**
 * Traduz a campanha em filtro de destinatários.
 *
 * **Só assinante `ACTIVE` recebe**, sempre — a condição não vem da segmentação
 * e não pode ser sobrescrita por ela. Quem cancelou, sofreu bounce ou está
 * bloqueado nunca entra, seja qual for o critério salvo.
 */
export function audienceWhere(campaign: {
  targetAll: boolean;
  targetSubscriberIds: string[];
  targetSegments: unknown;
}): Prisma.NewsletterSubscriberWhereInput {
  const base: Prisma.NewsletterSubscriberWhereInput = {
    status: SubscriptionStatus.ACTIVE,
  };

  if (campaign.targetSubscriberIds.length > 0) {
    return { ...base, id: { in: campaign.targetSubscriberIds } };
  }

  if (campaign.targetAll) {
    return base;
  }

  const segments = readSegments(campaign.targetSegments);

  return {
    ...base,
    ...(segments.interests?.length
      ? { interests: { hasSome: segments.interests } }
      : {}),
    ...(segments.favoriteInstruments?.length
      ? { favoriteInstruments: { hasSome: segments.favoriteInstruments } }
      : {}),
    ...(segments.favoriteEpochs?.length
      ? { favoriteEpochs: { hasSome: segments.favoriteEpochs } }
      : {}),
    ...(segments.experienceLevel
      ? { experienceLevel: segments.experienceLevel }
      : {}),
    ...(segments.frequency ? { frequency: segments.frequency } : {}),
    ...(segments.language ? { language: segments.language } : {}),
    ...(segments.engagedSince
      ? { lastEmailOpenedAt: { gte: new Date(segments.engagedSince) } }
      : {}),
  };
}
