import { escapeRegex } from '../../common/utils/regex.util';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AdPlacement,
  AdStatus,
  AdTargetType,
  AdType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { errorMessage } from '../../common/utils/error.util';
import {
  AttachAdMediaDto,
  CheckAdConflictQueryDto,
  CloneAdDto,
  CreateAdDto,
  ListAdsQueryDto,
  UpdateAdDto,
} from './dto/admin-ads.dto';

/** Entidade dona da mídia no registro de armazenamento. */
const ASSET_ENTITY_TYPE = 'advertisement';

const AD_SELECT = {
  id: true,
  title: true,
  description: true,
  content: true,
  ctaText: true,
  targetUrl: true,
  linkType: true,
  isExternal: true,
  imageUrl: true,
  thumbnailUrl: true,
  videoUrl: true,
  type: true,
  placement: true,
  status: true,
  targetType: true,
  targetUserLevel: true,
  instrumentId: true,
  advertiserName: true,
  advertiserEmail: true,
  advertiserPhone: true,
  advertiserWebsite: true,
  startDate: true,
  endDate: true,
  showOnMobile: true,
  showOnTablet: true,
  showOnDesktop: true,
  createdBy: true,
  lastEditedBy: true,
  lastEditedAt: true,
  createdAt: true,
  instrument: { select: { id: true, name: true } },
} as const;

@Injectable()
export class AdminAdsService {
  private readonly logger = new Logger(AdminAdsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // -------------------------------------------------------------------
  // Listagem
  // -------------------------------------------------------------------

  /**
   * Lista os anúncios com impressões e cliques.
   *
   * **Os totais saem de uma agregação, não de somar linhas em memória.** O
   * legado carregava a relação `stats` inteira de cada anúncio — `AdStats` tem
   * uma linha por dia e por dispositivo, então um anúncio de um ano são ~1.100
   * linhas, e uma página de vinte anúncios trazia mais de vinte mil registros
   * do banco para somar dois inteiros em JavaScript.
   */
  async list(query: ListAdsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();

    const where: Prisma.AdvertisementWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.placement ? { placement: query.placement } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: escapeRegex(search), mode: 'insensitive' } },
              {
                advertiserName: {
                  contains: escapeRegex(search),
                  mode: 'insensitive',
                },
              },
              {
                description: {
                  contains: escapeRegex(search),
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };

    const [ads, total] = await Promise.all([
      this.prisma.advertisement.findMany({
        where,
        select: AD_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.advertisement.count({ where }),
    ]);

    const performance = await this.performanceFor(ads.map((ad) => ad.id));

    return {
      ads: ads.map((ad) => ({
        ...ad,
        performance: performance.get(ad.id) ?? EMPTY_PERFORMANCE,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Impressões, cliques e CTR de cada anúncio, numa agregação só. */
  private async performanceFor(adIds: string[]) {
    if (adIds.length === 0) {
      return new Map<string, AdPerformance>();
    }

    const rows = await this.prisma.adStats.groupBy({
      by: ['advertisementId'],
      where: { advertisementId: { in: adIds } },
      _sum: { impressions: true, clicks: true },
    });

    return new Map(
      rows.map((row) => {
        const impressions = row._sum.impressions ?? 0;
        const clicks = row._sum.clicks ?? 0;

        return [
          row.advertisementId,
          {
            impressions,
            clicks,
            // `null`, e não 0%, quando o anúncio nunca foi exibido: taxa de
            // clique sem impressão não é zero, é ausência de medida.
            ctr:
              impressions > 0
                ? Math.round((clicks / impressions) * 10000) / 100
                : null,
          },
        ];
      }),
    );
  }

  async overview() {
    const [byStatus, totals] = await Promise.all([
      this.prisma.advertisement.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.adStats.aggregate({
        _sum: { impressions: true, clicks: true },
      }),
    ]);

    const impressions = totals._sum.impressions ?? 0;
    const clicks = totals._sum.clicks ?? 0;

    return {
      byStatus: Object.fromEntries(
        byStatus.map((row) => [row.status, row._count._all]),
      ),
      total: byStatus.reduce((sum, row) => sum + row._count._all, 0),
      impressions,
      clicks,
      ctr:
        impressions > 0
          ? Math.round((clicks / impressions) * 10000) / 100
          : null,
    };
  }

  async findOne(adId: string) {
    const ad = await this.prisma.advertisement.findUnique({
      where: { id: adId },
      select: AD_SELECT,
    });

    if (!ad) {
      throw new NotFoundException('Anúncio não encontrado');
    }

    const performance = await this.performanceFor([adId]);

    return { ...ad, performance: performance.get(adId) ?? EMPTY_PERFORMANCE };
  }

  // -------------------------------------------------------------------
  // Conflito de combinação
  // -------------------------------------------------------------------

  /**
   * Verifica a combinação única `[tipo + posicionamento + segmentação +
   * instrumento]`.
   *
   * **Os valores efetivos são resolvidos antes de consultar.** No legado a
   * checagem usava o corpo cru: com `placement` ausente, o Prisma descartava o
   * campo e a busca casava com um anúncio de **outro** posicionamento,
   * recusando a criação com uma mensagem que citava um anúncio sem relação com
   * o conflito. Aqui os defaults do schema são aplicados antes.
   */
  async checkConflict(query: CheckAdConflictQueryDto) {
    const existing = await this.prisma.advertisement.findFirst({
      where: {
        type: query.type,
        placement: query.placement,
        targetType: query.targetType,
        instrumentId: query.instrumentId ?? null,
        ...(query.excludeAdId ? { id: { not: query.excludeAdId } } : {}),
      },
      select: { id: true, title: true, status: true },
    });

    return {
      hasConflict: existing !== null,
      conflictingAd: existing,
      combination: {
        type: query.type,
        placement: query.placement,
        targetType: query.targetType,
        instrumentId: query.instrumentId ?? null,
      },
    };
  }

  // -------------------------------------------------------------------
  // Escrita
  // -------------------------------------------------------------------

  async create(adminUserId: string, dto: CreateAdDto) {
    const combination = this.resolveCombination(dto);

    this.assertPeriod(dto.startDate, dto.endDate);

    try {
      return await this.prisma.advertisement.create({
        data: {
          ...this.contentData(dto),
          title: dto.title.trim(),
          advertiserName: dto.advertiserName.trim(),
          ...combination,
          status: dto.status ?? AdStatus.DRAFT,
          createdBy: adminUserId,
        },
        select: AD_SELECT,
      });
    } catch (error: unknown) {
      throw await this.translateConflict(error, combination);
    }
  }

  async update(adminUserId: string, adId: string, dto: UpdateAdDto) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Nada para atualizar');
    }

    const current = await this.prisma.advertisement.findUnique({
      where: { id: adId },
      select: {
        id: true,
        type: true,
        placement: true,
        targetType: true,
        instrumentId: true,
        startDate: true,
        endDate: true,
      },
    });

    if (!current) {
      throw new NotFoundException('Anúncio não encontrado');
    }

    this.assertPeriod(
      dto.startDate ?? current.startDate?.toISOString(),
      dto.endDate ?? current.endDate?.toISOString(),
    );

    const combination = {
      type: dto.type ?? current.type,
      placement: dto.placement ?? current.placement,
      targetType: dto.targetType ?? current.targetType,
      instrumentId: dto.instrumentId ?? current.instrumentId,
    };

    try {
      return await this.prisma.advertisement.update({
        where: { id: adId },
        data: {
          ...this.contentData(dto),
          title: dto.title?.trim(),
          advertiserName: dto.advertiserName?.trim(),
          type: dto.type,
          placement: dto.placement,
          targetType: dto.targetType,
          instrumentId: dto.instrumentId,
          status: dto.status,
          lastEditedBy: adminUserId,
          lastEditedAt: new Date(),
        },
        select: AD_SELECT,
      });
    } catch (error: unknown) {
      throw await this.translateConflict(error, combination, adId);
    }
  }

  /**
   * Duplica um anúncio.
   *
   * **A verificação de conflito é uma chamada de método.** O legado fazia
   * `fetch()` para a própria API — montando a URL com
   * `process.env.NEXTAUTH_URL || 'http://localhost:3000'` e repassando o cookie
   * de sessão do administrador. Além do salto de rede desnecessário e do
   * endereço fixo que quebra fora de desenvolvimento, o resultado só era
   * considerado dentro de `if (response.ok)`: **qualquer falha na
   * autochamada fazia a verificação ser pulada em silêncio** e o clone era
   * criado assim mesmo, violando a restrição.
   *
   * A mídia não é copiada: o clone nasce sem imagem e sem vídeo, para dois
   * anúncios não passarem a apontar para o mesmo arquivo — apagar um levaria a
   * imagem do outro.
   */
  async clone(adminUserId: string, adId: string, dto: CloneAdDto) {
    const original = await this.prisma.advertisement.findUnique({
      where: { id: adId },
      select: AD_SELECT,
    });

    if (!original) {
      throw new NotFoundException('Anúncio não encontrado');
    }

    const combination = {
      type: dto.type ?? original.type,
      placement: dto.placement ?? original.placement,
      targetType: dto.targetType ?? original.targetType,
      instrumentId: dto.instrumentId ?? original.instrumentId,
    };

    try {
      return await this.prisma.advertisement.create({
        data: {
          title: dto.title?.trim() ?? `${original.title} — Cópia`,
          description: original.description,
          content: original.content,
          ctaText: original.ctaText,
          targetUrl: original.targetUrl,
          linkType: original.linkType,
          isExternal: original.isExternal,
          advertiserName: original.advertiserName,
          advertiserEmail: original.advertiserEmail,
          advertiserPhone: original.advertiserPhone,
          advertiserWebsite: original.advertiserWebsite,
          targetUserLevel: original.targetUserLevel,
          showOnMobile: original.showOnMobile,
          showOnTablet: original.showOnTablet,
          showOnDesktop: original.showOnDesktop,
          ...combination,
          // O clone nasce rascunho: duplicar não é publicar.
          status: AdStatus.DRAFT,
          createdBy: adminUserId,
        },
        select: AD_SELECT,
      });
    } catch (error: unknown) {
      throw await this.translateConflict(error, combination);
    }
  }

  /**
   * Remove o anúncio e a mídia dele.
   *
   * A mídia sai pelo registro de `StoredAsset`, **não pelo título**. O legado
   * apagava um diretório derivado do título do anúncio: renomear o anúncio
   * depois do envio deixava o arquivo órfão no armazenamento para sempre.
   */
  async remove(adId: string): Promise<void> {
    const ad = await this.prisma.advertisement.findUnique({
      where: { id: adId },
      select: { id: true },
    });

    if (!ad) {
      throw new NotFoundException('Anúncio não encontrado');
    }

    try {
      await this.storage.deleteByEntity(ASSET_ENTITY_TYPE, adId);
    } catch (error: unknown) {
      this.logger.error(
        `Falha ao remover mídia do anúncio ${adId}: ${errorMessage(error)}`,
      );
    }

    // `AdStats` sai em cascata pela relação.
    await this.prisma.advertisement.delete({ where: { id: adId } });
  }

  // -------------------------------------------------------------------
  // Mídia
  // -------------------------------------------------------------------

  /** Anexa ao anúncio uma mídia já enviada e confirmada pelo módulo de uploads. */
  async attachMedia(adminUserId: string, adId: string, dto: AttachAdMediaDto) {
    const ad = await this.prisma.advertisement.findUnique({
      where: { id: adId },
      select: { id: true },
    });

    if (!ad) {
      throw new NotFoundException('Anúncio não encontrado');
    }

    const asset = await this.storage.confirmUpload(dto.assetId, adminUserId);

    await this.prisma.storedAsset.update({
      where: { id: asset.id },
      data: { entityType: ASSET_ENTITY_TYPE, entityId: adId },
    });

    const isVideo = dto.kind === 'video';

    return this.prisma.advertisement.update({
      where: { id: adId },
      data: {
        ...(isVideo
          ? { videoUrl: asset.secureUrl }
          : { imageUrl: asset.secureUrl }),
        lastEditedBy: adminUserId,
        lastEditedAt: new Date(),
      },
      select: AD_SELECT,
    });
  }

  /**
   * Tira a imagem ou o vídeo do anúncio — o que faltava do `DELETE` do legado.
   *
   * Apaga do armazenamento só o arquivo que estava no campo; a mídia do outro
   * tipo fica. Arquivo gravado pelo legado (sem registro) é só desvinculado.
   */
  async removeMedia(
    adminUserId: string,
    adId: string,
    kind: 'image' | 'video',
  ) {
    const ad = await this.prisma.advertisement.findUnique({
      where: { id: adId },
      select: { id: true, imageUrl: true, videoUrl: true },
    });

    if (!ad) {
      throw new NotFoundException('Anúncio não encontrado');
    }

    const url = kind === 'video' ? ad.videoUrl : ad.imageUrl;

    if (url) {
      const assets = await this.prisma.storedAsset.findMany({
        where: {
          entityType: ASSET_ENTITY_TYPE,
          entityId: adId,
          secureUrl: url,
        },
        select: { id: true },
      });

      for (const asset of assets) {
        await this.storage.deleteAsset(asset.id);
      }
    }

    return this.prisma.advertisement.update({
      where: { id: adId },
      data: {
        ...(kind === 'video' ? { videoUrl: null } : { imageUrl: null }),
        lastEditedBy: adminUserId,
        lastEditedAt: new Date(),
      },
      select: AD_SELECT,
    });
  }

  // -------------------------------------------------------------------

  /** Aplica os defaults do schema antes de qualquer verificação. */
  private resolveCombination(dto: CreateAdDto) {
    return {
      type: dto.type ?? AdType.BANNER,
      placement: dto.placement ?? AdPlacement.SIDEBAR_RIGHT,
      targetType: dto.targetType ?? AdTargetType.GENERAL,
      instrumentId: dto.instrumentId ?? null,
    };
  }

  /**
   * Converte a violação da restrição única numa resposta útil.
   *
   * **Pelo código do erro, não pelo texto.** O legado testava
   * `error.message.includes('unique constraint')` — uma comparação de texto que
   * muda entre versões do Prisma e depende do idioma da mensagem.
   *
   * A restrição do banco é a autoridade: em vez de checar antes e criar depois
   * — o que deixa uma janela entre a checagem e a escrita —, a criação tenta e
   * a violação é traduzida aqui, já com o anúncio que ocupa a combinação.
   */
  private async translateConflict(
    error: unknown,
    combination: {
      type: AdType;
      placement: AdPlacement;
      targetType: AdTargetType;
      instrumentId: string | null;
    },
    excludeAdId?: string,
  ): Promise<unknown> {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return error;
    }

    const { conflictingAd } = await this.checkConflict({
      ...combination,
      instrumentId: combination.instrumentId ?? undefined,
      excludeAdId,
    });

    return new ConflictException({
      message:
        'Já existe um anúncio nesta combinação de tipo, posicionamento e segmentação.',
      combination,
      conflictingAd,
    });
  }

  private assertPeriod(start?: string | null, end?: string | null): void {
    if (!start || !end) {
      return;
    }

    if (new Date(end) <= new Date(start)) {
      throw new BadRequestException(
        'A data final da veiculação precisa ser posterior à inicial',
      );
    }
  }

  private contentData(dto: CreateAdDto | UpdateAdDto) {
    return {
      description: dto.description?.trim(),
      content: dto.content?.trim(),
      ctaText: dto.ctaText?.trim(),
      targetUrl: dto.targetUrl?.trim(),
      linkType: dto.linkType,
      isExternal: dto.isExternal,
      targetUserLevel: dto.targetUserLevel,
      advertiserEmail: dto.advertiserEmail?.trim(),
      advertiserPhone: dto.advertiserPhone?.trim(),
      advertiserWebsite: dto.advertiserWebsite?.trim(),
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      showOnMobile: dto.showOnMobile,
      showOnTablet: dto.showOnTablet,
      showOnDesktop: dto.showOnDesktop,
    };
  }
}

export interface AdPerformance {
  impressions: number;
  clicks: number;
  ctr: number | null;
}

const EMPTY_PERFORMANCE: AdPerformance = {
  impressions: 0,
  clicks: 0,
  ctr: null,
};
