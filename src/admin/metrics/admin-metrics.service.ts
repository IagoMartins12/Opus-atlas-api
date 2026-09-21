import { Injectable } from '@nestjs/common';
import { AudienceInsightsService } from './audience-insights.service';
import { CatalogInsightsService } from './catalog-insights.service';
import { Insight, sortInsights, summarize } from './insight';
import { LearningInsightsService } from './learning-insights.service';
import { MonetizationInsightsService } from './monetization-insights.service';
import { PlatformOverviewService } from './platform-overview.service';
import { TeachingInsightsService } from './teaching-insights.service';

export type InsightArea =
  | 'catalog'
  | 'learning'
  | 'audience'
  | 'teaching'
  | 'monetization';

export const INSIGHT_AREAS: InsightArea[] = [
  'catalog',
  'learning',
  'audience',
  'teaching',
  'monetization',
];

@Injectable()
export class AdminMetricsService {
  constructor(
    private readonly overviewService: PlatformOverviewService,
    private readonly catalog: CatalogInsightsService,
    private readonly learning: LearningInsightsService,
    private readonly audience: AudienceInsightsService,
    private readonly teaching: TeachingInsightsService,
    private readonly monetization: MonetizationInsightsService,
  ) {}

  overview() {
    return this.overviewService.overview();
  }

  /**
   * Reúne os insights das áreas pedidas.
   *
   * As áreas rodam em paralelo e o resultado sai ordenado pelo que exige
   * atenção primeiro. Um insight sem amostra suficiente não vira veredito —
   * o construtor o rebaixa para `insufficient_data` e some do topo da lista.
   */
  async insights(areas: InsightArea[] = INSIGHT_AREAS) {
    const wanted = new Set(areas);

    const collected = await Promise.all(
      [
        wanted.has('catalog') ? this.catalog.collect() : null,
        wanted.has('learning') ? this.learning.collect() : null,
        wanted.has('audience') ? this.audience.collect() : null,
        wanted.has('teaching') ? this.teaching.collect() : null,
        wanted.has('monetization') ? this.monetization.collect() : null,
      ].filter((task): task is Promise<Insight[]> => task !== null),
    );

    const insights = sortInsights(collected.flat());

    return {
      generatedAt: new Date(),
      areas: [...wanted],
      summary: summarize(insights),
      insights,
    };
  }
}
