import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppCacheService } from '../../common/cache/cache.service';
import { correctedEpoch } from '../../catalog/quality/composer-epoch';
import { PrismaService } from '../../prisma/prisma.service';

const CACHE_KEY = 'admin-catalog:quality';
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Preenchido de verdade: nem ausente, nem nulo, nem vazio. */
const filled = (field: string) => ({
  AND: [{ [field]: { not: null } }, { NOT: { [field]: '' } }],
});

export interface CatalogQuality {
  generatedAt: string;
  composers: {
    total: number;
    verified: number;
    withBirthYear: number;
    withNationality: number;
    withBio: number;
    /** Escrita por IA e ainda sem leitura de uma pessoa (ou tradução de máquina). */
    bioWaitingReview: number;
    withPortrait: number;
    /** Com ano de nascimento: quantos têm a época de acordo com as datas. */
    epochChecked: number;
    epochInAgreement: number;
  };
  works: {
    total: number;
    withTone: number;
    withYear: number;
    withInstrumentation: number;
    withMedia: number;
  };
}

/**
 * O quadro de qualidade do acervo: quanto do cadastro está preenchido e
 * confere, para acompanhar a evolução depois de cada correção em lote. Contas
 * pesadas; vive 10 minutos em cache.
 */
@Injectable()
export class CatalogQualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AppCacheService,
  ) {}

  async get(): Promise<CatalogQuality> {
    const cached = await this.cache.get<CatalogQuality>(CACHE_KEY);
    if (cached) return cached;

    const c = this.prisma.composer;
    const w = this.prisma.work;
    const waiting: Prisma.ComposerWhereInput = {
      OR: [
        {
          AND: [
            { bioGeneratedBy: { not: null } },
            {
              OR: [
                { bioReviewedAt: { isSet: false } },
                { bioReviewedAt: null },
              ],
            },
          ],
        },
        { bioTranslatedFrom: { in: ['pt', 'en'] } },
      ],
    };

    const [
      total,
      verified,
      withBirthYear,
      withNationality,
      withBio,
      bioWaitingReview,
      withPortrait,
      withEpoch,
      worksTotal,
      withTone,
      withYear,
      withInstrumentation,
      withMedia,
    ] = await Promise.all([
      c.count(),
      c.count({ where: { isVerified: true } }),
      c.count({ where: { birthYear: { not: null } } }),
      c.count({ where: filled('nationality') }),
      c.count({ where: filled('bio') }),
      c.count({ where: waiting }),
      c.count({ where: filled('portraitUrl') }),
      c.findMany({
        where: { birthYear: { not: null } },
        select: { epochName: true, birthYear: true },
      }),
      w.count(),
      w.count({ where: filled('tone') }),
      w.count({ where: filled('compositionYear') }),
      w.count({ where: filled('instrumentation') }),
      w.count({
        where: {
          OR: [
            filled('youtubeVideoId'),
            filled('spotifyTrackId'),
            filled('customAudioUrl'),
          ],
        },
      }),
    ]);

    const epochInAgreement = withEpoch.filter(
      (row) => correctedEpoch(row.epochName, row.birthYear) === null,
    ).length;

    const quality: CatalogQuality = {
      generatedAt: new Date().toISOString(),
      composers: {
        total,
        verified,
        withBirthYear,
        withNationality,
        withBio,
        bioWaitingReview,
        withPortrait,
        epochChecked: withEpoch.length,
        epochInAgreement,
      },
      works: {
        total: worksTotal,
        withTone,
        withYear,
        withInstrumentation,
        withMedia,
      },
    };
    await this.cache.set(CACHE_KEY, quality, CACHE_TTL_MS);
    return quality;
  }
}
