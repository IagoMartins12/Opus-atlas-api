import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class AdInstrumentDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Piano' })
  name: string;
}

class AdPerformanceDto {
  @ApiProperty() impressions: number;
  @ApiProperty() clicks: number;

  @ApiProperty({
    nullable: true,
    example: 2.14,
    description: 'Em porcentagem. Nulo sem nenhuma impressão.',
  })
  ctr: number | null;
}

/** O anúncio como o painel o vê — inclui contato do anunciante e desempenho. */
export class AdminAdDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true }) description: string | null;
  @ApiProperty({ nullable: true }) content: string | null;
  @ApiProperty({ nullable: true }) ctaText: string | null;
  @ApiProperty({ nullable: true }) targetUrl: string | null;
  @ApiProperty({ nullable: true }) linkType: string | null;
  @ApiProperty() isExternal: boolean;
  @ApiProperty({ nullable: true }) imageUrl: string | null;
  @ApiProperty({ nullable: true }) thumbnailUrl: string | null;
  @ApiProperty({ nullable: true }) videoUrl: string | null;

  @ApiProperty({ example: 'BANNER' }) type: string;
  @ApiProperty({ example: 'SIDEBAR' }) placement: string;

  @ApiProperty({ enum: ['DRAFT', 'ACTIVE', 'PAUSED', 'FINISHED'] })
  status: string;

  @ApiProperty({ nullable: true }) targetType: string | null;
  @ApiProperty({ nullable: true }) targetUserLevel: string | null;
  @ApiProperty({ nullable: true }) instrumentId: string | null;
  @ApiProperty({ nullable: true }) advertiserName: string | null;
  @ApiProperty({ nullable: true }) advertiserEmail: string | null;
  @ApiProperty({ nullable: true }) advertiserPhone: string | null;
  @ApiProperty({ nullable: true }) advertiserWebsite: string | null;
  @ApiProperty({ nullable: true }) startDate: Date | null;
  @ApiProperty({ nullable: true }) endDate: Date | null;
  @ApiProperty() showOnMobile: boolean;
  @ApiProperty() showOnTablet: boolean;
  @ApiProperty() showOnDesktop: boolean;
  @ApiProperty({ nullable: true }) createdBy: string | null;
  @ApiProperty({ nullable: true }) lastEditedBy: string | null;
  @ApiProperty({ nullable: true }) lastEditedAt: Date | null;
  @ApiProperty() createdAt: Date;

  @ApiProperty({ type: AdInstrumentDto, nullable: true })
  instrument: AdInstrumentDto | null;

  @ApiPropertyOptional({
    type: AdPerformanceDto,
    description: 'Presente na listagem e no detalhe.',
  })
  performance?: AdPerformanceDto;
}

class AdsPaginationDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 37 }) total: number;
  @ApiProperty({ example: 2 }) totalPages: number;
}

export class AdminAdsListDto {
  @ApiProperty({ type: [AdminAdDto] })
  ads: AdminAdDto[];

  @ApiProperty({ type: AdsPaginationDto })
  pagination: AdsPaginationDto;
}

export class AdsOverviewDto {
  @ApiProperty({
    example: { ACTIVE: 4, DRAFT: 2 },
    additionalProperties: { type: 'number' },
    type: 'object',
  })
  byStatus: Record<string, number>;

  @ApiProperty() total: number;
  @ApiProperty() impressions: number;
  @ApiProperty() clicks: number;

  @ApiProperty({
    nullable: true,
    description: 'Em porcentagem. Nulo sem nenhuma impressão.',
  })
  ctr: number | null;
}

class AdCombinationDto {
  @ApiProperty() type: string;
  @ApiProperty() placement: string;
  @ApiProperty() targetType: string;

  @ApiProperty({ nullable: true })
  instrumentId: string | null;
}

/**
 * A combinação de tipo, posição, segmentação e instrumento é única: dois
 * anúncios ativos no mesmo lugar disputariam a mesma vaga.
 */
export class AdConflictDto {
  @ApiProperty()
  hasConflict: boolean;

  @ApiProperty({
    type: AdminAdDto,
    nullable: true,
    description: 'O anúncio que já ocupa a combinação.',
  })
  conflictingAd: AdminAdDto | null;

  @ApiProperty({ type: AdCombinationDto })
  combination: AdCombinationDto;
}
