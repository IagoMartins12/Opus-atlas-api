import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CacheNamespace } from '../../common/cache/cache-keys';
import { AppCacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_COMPOSER } from './composer-role';
import { OnThisDayComposerDto, OnThisDayDto } from './dto/on-this-day.dto';

/** A day's list changes only when composers are added: cache it for hours. */
const ON_THIS_DAY_TTL_MS = 6 * 60 * 60 * 1000;
const PER_LIST = 48;

const SELECT = {
  id: true,
  name: true,
  fullName: true,
  portraitUrl: true,
  hasValidImage: true,
  birthYear: true,
  deathYear: true,
  nationality: true,
  epochName: true,
  isVerified: true,
} as const;

/** Best known first: a real portrait and a fuller record lead. */
const ORDER: Prisma.ComposerOrderByWithRelationInput[] = [
  { hasValidImage: 'desc' },
  { dataCompleteness: 'desc' },
  { birthYear: 'asc' },
];

/**
 * "Born on a day like today": composers born and those who died on a given
 * calendar day, read from the numeric date parts (indexed on month + day).
 */
@Injectable()
export class ComposerOnThisDayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AppCacheService,
  ) {}

  get(month: number, day: number): Promise<OnThisDayDto> {
    return this.cache.remember(
      `${CacheNamespace.COMPOSERS}:on-this-day:v2:${month}-${day}`,
      { ttlMs: ON_THIS_DAY_TTL_MS, metricRoute: 'composers/on-this-day' },
      async () => {
        const [born, died] = await Promise.all([
          this.prisma.composer.findMany({
            where: { AND: [IS_COMPOSER, { birthMonth: month, birthDay: day }] },
            select: SELECT,
            orderBy: ORDER,
            take: PER_LIST,
          }),
          this.prisma.composer.findMany({
            where: { AND: [IS_COMPOSER, { deathMonth: month, deathDay: day }] },
            select: SELECT,
            orderBy: ORDER,
            take: PER_LIST,
          }),
        ]);
        return {
          month,
          day,
          born: unique(born).map(toItem),
          died: unique(died).map(toItem),
        };
      },
    );
  }
}

/**
 * The archive holds some people twice (two imports of the same IMSLP page).
 * Same full name and years is the same person; the better record (first, by
 * the order above) stays.
 */
function unique<
  T extends {
    fullName: string;
    birthYear: number | null;
    deathYear: number | null;
  },
>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.fullName.trim().toLowerCase()}|${row.birthYear}|${row.deathYear}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toItem(
  row: Prisma.ComposerGetPayload<{ select: typeof SELECT }>,
): OnThisDayComposerDto {
  const { hasValidImage, portraitUrl, ...rest } = row;
  return {
    ...rest,
    portraitUrl: hasValidImage ? (portraitUrl ?? null) : null,
  };
}
