import { Injectable, NotFoundException } from '@nestjs/common';
import { AdStatus, AdTargetType, AdUserLevel, Prisma } from '@prisma/client';
import { isMongoId } from 'class-validator';
import { AppCacheService } from '../common/cache/cache.service';
import { localDate, zonedDate } from '../common/utils/time-zone';
import { viewerKey } from '../common/utils/viewer-key';
import { PrismaService } from '../prisma/prisma.service';
import { AdEventDto, PublicAdsQueryDto } from './public-ads.dto';

export type AdDevice = 'mobile' | 'tablet' | 'desktop';

/** O dia da estatística é o de Brasília, como o relatório do anunciante. */
const STATS_TIME_ZONE = 'America/Sao_Paulo';

/** Uma impressão e um clique por pessoa, por anúncio, nesta janela. */
const DEDUP_WINDOW_MS = 30 * 60 * 1000;

/** Hover mais longo que isto é aba esquecida aberta, não interesse. */
const MAX_HOVER_MS = 60_000;

const PUBLIC_AD_SELECT = {
  id: true,
  title: true,
  description: true,
  content: true,
  imageUrl: true,
  thumbnailUrl: true,
  videoUrl: true,
  ctaText: true,
  targetUrl: true,
  linkType: true,
  isExternal: true,
  type: true,
  placement: true,
  targetType: true,
  targetUserLevel: true,
  advertiserName: true,
  advertiserWebsite: true,
  showOnMobile: true,
  showOnTablet: true,
  showOnDesktop: true,
  instrumentId: true,
  instrument: { select: { id: true, name: true } },
} satisfies Prisma.AdvertisementSelect;

export function deviceOf(userAgent: string | undefined): AdDevice {
  const agent = userAgent ?? '';
  if (/tablet|ipad/i.test(agent)) return 'tablet';
  if (/mobile|android|iphone/i.test(agent)) return 'mobile';
  return 'desktop';
}

/**
 * Anúncio do lado de quem vê o site — servir e contar.
 *
 * O painel (`/admin/ads`) já existia na API; este lado não, e o front o chama
 * em toda página com espaço de anúncio (`AdsProvider`, `useFrontAds`).
 *
 * **Quatro defeitos do legado corrigidos:**
 *
 * 1. **O filtro de dispositivo vinha depois do `take: 1`.** O anúncio mais novo
 *    da posição era escolhido primeiro; se ele não era para celular, quem
 *    estava no celular ficava sem anúncio, havendo outros. Agora o dispositivo
 *    entra na consulta.
 * 2. **Qualquer um inflava impressão e clique** com um laço no `POST` — e é o
 *    número que o anunciante vê. Agora conta uma vez por pessoa por anúncio a
 *    cada 30 minutos (a pessoa é a conta, ou um resumo de IP e navegador; o IP
 *    não é guardado).
 * 3. **"Professor" era `role === 1`**, que é administrador. O nível sai de
 *    `isTeacher`/`isStudent`.
 * 4. **A estatística do dia era ler-somar-gravar**, e duas impressões
 *    simultâneas perdiam uma. Agora é `upsert` com incremento, sobre o índice
 *    único (anúncio, dia, dispositivo).
 */
@Injectable()
export class PublicAdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AppCacheService,
  ) {}

  async ads(query: PublicAdsQueryDto, device: AdDevice) {
    const now = new Date();
    const targetType = query.targetType ?? AdTargetType.GENERAL;

    const where: Prisma.AdvertisementWhereInput = {
      status: AdStatus.ACTIVE,
      AND: [
        { OR: [{ startDate: null }, { startDate: { lte: now } }] },
        { OR: [{ endDate: null }, { endDate: { gte: now } }] },
      ],
      targetType,
      ...(query.placement ? { placement: query.placement } : {}),
      ...(query.userLevel && query.userLevel !== AdUserLevel.ALL
        ? { targetUserLevel: { in: [AdUserLevel.ALL, query.userLevel] } }
        : {}),
      ...(targetType === AdTargetType.INSTRUMENT && query.instrumentId
        ? { instrumentId: query.instrumentId }
        : {}),
      ...(device === 'mobile'
        ? { showOnMobile: true }
        : device === 'tablet'
          ? { showOnTablet: true }
          : { showOnDesktop: true }),
    };

    const ads = await this.prisma.advertisement.findMany({
      where,
      select: PUBLIC_AD_SELECT,
      orderBy: { createdAt: 'desc' },
      // Um anúncio por combinação, como o legado — mas escolhido entre os
      // que servem para este dispositivo.
      take: 1,
    });

    return { success: true, ads, count: ads.length };
  }

  async track(
    dto: AdEventDto,
    viewer: {
      userId?: string;
      isTeacher?: boolean;
      isStudent?: boolean;
      ipAddress?: string;
      userAgent?: string;
      referrer?: string;
    },
  ): Promise<{ success: true; counted: boolean }> {
    const ad = isMongoId(dto.adId)
      ? await this.prisma.advertisement.findFirst({
          where: { id: dto.adId, status: AdStatus.ACTIVE },
          select: { id: true },
        })
      : null;

    if (!ad) {
      throw new NotFoundException('Anúncio não encontrado ou inativo');
    }

    // Impressão e clique contam uma vez por pessoa na janela; hover soma tempo.
    if (dto.event !== 'hover') {
      const key = viewerKey(viewer);

      if (!key) {
        return { success: true, counted: false };
      }

      const dedupKey = `ads:seen:${dto.event}:${ad.id}:${key}`;
      if (await this.cache.get<boolean>(dedupKey)) {
        return { success: true, counted: false };
      }
      await this.cache.set(dedupKey, true, DEDUP_WINDOW_MS);
    }

    const device = deviceOf(viewer.userAgent);
    const day = zonedDate(
      localDate(new Date(), STATS_TIME_ZONE),
      '00:00',
      STATS_TIME_ZONE,
    );
    const increment =
      dto.event === 'impression'
        ? { impressions: { increment: 1 } }
        : dto.event === 'click'
          ? { clicks: { increment: 1 } }
          : {
              hoverTime: {
                increment: Math.min(
                  Math.max(Math.round(dto.data?.duration ?? 0), 0),
                  MAX_HOVER_MS,
                ),
              },
            };

    const userLevel = viewer.isTeacher
      ? AdUserLevel.TEACHER
      : viewer.isStudent
        ? AdUserLevel.STUDENT
        : AdUserLevel.ALL;

    const unique = {
      unique_daily_stats: { advertisementId: ad.id, date: day, device },
    };
    const upsert = () =>
      this.prisma.adStats.upsert({
        where: unique,
        update: increment,
        create: {
          advertisementId: ad.id,
          date: day,
          device,
          userLevel,
          userId: viewer.userId ?? null,
          referrer: viewer.referrer?.slice(0, 500) ?? null,
          pageUrl: dto.data?.pageUrl?.slice(0, 500) ?? null,
          pageTitle: dto.data?.pageTitle?.slice(0, 200) ?? null,
          impressions: dto.event === 'impression' ? 1 : 0,
          clicks: dto.event === 'click' ? 1 : 0,
          hoverTime:
            dto.event === 'hover'
              ? Math.min(Math.max(dto.data?.duration ?? 0, 0), MAX_HOVER_MS)
              : 0,
        },
      });

    try {
      await upsert();
    } catch (error: unknown) {
      // Duas primeiras impressões do dia ao mesmo tempo: a segunda cria o
      // mesmo registro e colide no índice único. Agora ele existe; incrementa.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        await this.prisma.adStats.update({ where: unique, data: increment });
      } else {
        throw error;
      }
    }

    return { success: true, counted: true };
  }
}
