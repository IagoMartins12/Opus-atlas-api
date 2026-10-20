import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppCacheService } from '../../common/cache/cache.service';
import { correctedEpoch } from '../../catalog/quality/composer-epoch';
import { fieldIs, numberIs } from '../../common/database/optional-fields';
import { PrismaService } from '../../prisma/prisma.service';

const CACHE_KEY = 'admin-catalog:quality';
const CACHE_TTL_MS = 10 * 60 * 1000;

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
    /** Com pelo menos uma obra no catálogo. */
    withWorks: number;
    /** Papel diferente de Compositor no IMSLP e nenhuma obra: para revisar. */
    suspects: number;
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
      c.count({
        where: numberIs<Prisma.ComposerWhereInput>('birthYear', true),
      }),
      c.count({
        where: fieldIs<Prisma.ComposerWhereInput>('nationality', true),
      }),
      c.count({ where: fieldIs<Prisma.ComposerWhereInput>('bio', true) }),
      c.count({ where: waiting }),
      c.count({
        where: fieldIs<Prisma.ComposerWhereInput>('portraitUrl', true),
      }),
      c.findMany({
        where: { birthYear: { not: null } },
        select: { epochName: true, birthYear: true },
      }),
      w.count(),
      w.count({ where: fieldIs<Prisma.WorkWhereInput>('tone', true) }),
      w.count({
        where: fieldIs<Prisma.WorkWhereInput>('compositionYear', true),
      }),
      w.count({
        where: fieldIs<Prisma.WorkWhereInput>('instrumentation', true),
      }),
      w.count({
        where: {
          OR: [
            fieldIs<Prisma.WorkWhereInput>('youtubeVideoId', true),
            fieldIs<Prisma.WorkWhereInput>('spotifyTrackId', true),
            fieldIs<Prisma.WorkWhereInput>('customAudioUrl', true),
          ],
        },
      }),
    ]);

    // Compositores com obra: a mesma conta que a lista usa para "sem obras".
    const withWorkIds = (
      await this.prisma.work.groupBy({ by: ['composerId'] })
    ).map((row) => row.composerId);
    const composerRole = await this.prisma.role.findFirst({
      where: { name: 'Compositor' },
      select: { id: true },
    });
    const suspects = await c.count({
      where: {
        ...(composerRole ? { primaryRoleId: { not: composerRole.id } } : {}),
        id: { notIn: withWorkIds },
      },
    });

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
        withWorks: withWorkIds.length,
        suspects,
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
