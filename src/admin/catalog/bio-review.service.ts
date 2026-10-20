import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppCacheService } from '../../common/cache/cache.service';
import { CATALOG_NAMESPACES } from '../../common/cache/cache-keys';
import { nextCursorOf, pageArgs } from '../../common/pagination/cursor';
import { escapeRegex } from '../../common/utils/regex.util';
import { PrismaService } from '../../prisma/prisma.service';
import { ListBioReviewQueryDto, ReviewBioDto } from './dto/bio-review.dto';

const REVIEW_SELECT = {
  id: true,
  name: true,
  fullName: true,
  portraitUrl: true,
  epochName: true,
  bio: true,
  bioEn: true,
  bioGeneratedBy: true,
  bioGeneratedAt: true,
  bioTranslatedFrom: true,
  bioReviewedAt: true,
  _count: { select: { works: true } },
} as const;

/** Never read by the team: absent on almost every composer, so `isSet` too. */
const NOT_REVIEWED: Prisma.ComposerWhereInput = {
  OR: [{ bioReviewedAt: { isSet: false } }, { bioReviewedAt: null }],
};

/**
 * What still waits for a person: a biography written by the AI that nobody
 * read, or a machine translation nobody read (even of a human text).
 */
const PENDING: Prisma.ComposerWhereInput = {
  OR: [
    { AND: [{ bioGeneratedBy: { not: null } }, NOT_REVIEWED] },
    { bioTranslatedFrom: { in: ['pt', 'en'] } },
  ],
};

/** Read by the team and nothing new waiting since. */
const REVIEWED: Prisma.ComposerWhereInput = {
  AND: [{ bioReviewedAt: { not: null } }, { NOT: PENDING }],
};

/**
 * The review of biographies in the panel.
 *
 * The site writes a biography with AI when a composer arrives without one, and
 * translates it between Portuguese and English. Both are labeled to the reader
 * ("not yet reviewed by a person") until someone from the team reads them
 * here: approve as is, or rewrite and approve. Rewriting makes the text a
 * person's (the AI mark goes); approving keeps the origin honest — still
 * AI-written, now "reviewed by the team".
 */
@Injectable()
export class BioReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AppCacheService,
  ) {}

  async list(query: ListBioReviewQueryDto) {
    const status = query.status ?? 'pending';
    const limit = query.limit ?? 20;
    const search = query.search?.trim();
    const where: Prisma.ComposerWhereInput = {
      AND: [
        status === 'pending' ? PENDING : REVIEWED,
        ...(search
          ? [
              {
                OR: [
                  {
                    name: {
                      contains: escapeRegex(search),
                      mode: 'insensitive' as const,
                    },
                  },
                  {
                    fullName: {
                      contains: escapeRegex(search),
                      mode: 'insensitive' as const,
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    };
    const paging = pageArgs({ cursor: query.cursor, page: 1, limit });

    const [rows, pending, reviewed] = await Promise.all([
      this.prisma.composer.findMany({
        where,
        select: REVIEW_SELECT,
        // The id breaks ties, or the cursor skips and repeats.
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: paging.take,
        skip: paging.skip,
        cursor: paging.cursor,
      }),
      this.prisma.composer.count({ where: PENDING }),
      this.prisma.composer.count({ where: REVIEWED }),
    ]);

    return {
      items: rows.map((row) => this.toItem(row)),
      counts: { pending, reviewed },
      nextCursor: nextCursorOf(rows, limit),
    };
  }

  /**
   * Approves a composer's biography, rewriting either language on the way.
   * Idempotent: approving twice only moves the date.
   */
  async review(adminUserId: string, composerId: string, dto: ReviewBioDto) {
    const composer = await this.prisma.composer.findUnique({
      where: { id: composerId },
      select: { id: true, bio: true, bioEn: true },
    });
    if (!composer) throw new NotFoundException('Compositor não encontrado');

    const bio = dto.bio?.trim();
    const bioEn = dto.bioEn?.trim();
    if (!(bio || composer.bio) && !(bioEn || composer.bioEn)) {
      throw new BadRequestException(
        'Este compositor não tem biografia para revisar.',
      );
    }

    const data: Prisma.ComposerUncheckedUpdateInput = {
      bioReviewedAt: new Date(),
      bioReviewedBy: adminUserId,
      // Read here, translation included: nothing machine-made is left waiting.
      bioTranslatedFrom: null,
    };
    // Compared trimmed on both sides: a stored text with a trailing space and
    // the same text sent back is not a rewrite.
    if (bio && bio !== composer.bio?.trim()) {
      data.bio = bio;
      // A person wrote this one now.
      data.bioGeneratedBy = null;
      data.bioGeneratedAt = null;
    }
    if (bioEn && bioEn !== composer.bioEn?.trim()) data.bioEn = bioEn;

    const updated = await this.prisma.composer.update({
      where: { id: composerId },
      data,
      select: REVIEW_SELECT,
    });
    await this.cache.invalidateMany(CATALOG_NAMESPACES);

    return this.toItem(updated);
  }

  private toItem(
    row: Prisma.ComposerGetPayload<{ select: typeof REVIEW_SELECT }>,
  ) {
    return {
      id: row.id,
      name: row.fullName || row.name,
      portraitUrl: row.portraitUrl ?? null,
      epochName: row.epochName ?? null,
      worksCount: row._count.works,
      bio: row.bio ?? null,
      bioEn: row.bioEn ?? null,
      writtenByAi: Boolean(row.bioGeneratedBy),
      generatedBy: row.bioGeneratedBy ?? null,
      generatedAt: row.bioGeneratedAt ?? null,
      translatedFrom:
        row.bioTranslatedFrom === 'pt' || row.bioTranslatedFrom === 'en'
          ? row.bioTranslatedFrom
          : null,
      reviewedAt: row.bioReviewedAt ?? null,
    };
  }
}
