import { Injectable } from '@nestjs/common';
import { SearchService as BlogSearchService } from '../blog/search/search.service';
import { ComposersService } from '../catalog/composers/composers.service';
import { WorksService } from '../catalog/works/works.service';
import {
  SiteSearchQueryDto,
  SiteSearchResponseDto,
} from './dto/site-search.dto';

/**
 * One query, three groups: composers, works and blog articles.
 *
 * Each underlying search already caches its own result (composers and works
 * in Redis, articles through `cachedRead`), so this service only fans out in
 * parallel and trims each group. A failure in one group (e.g. the blog) must
 * not empty the others, hence `allSettled`.
 */
@Injectable()
export class SiteSearchService {
  constructor(
    private readonly composers: ComposersService,
    private readonly works: WorksService,
    private readonly articles: BlogSearchService,
  ) {}

  async search(query: SiteSearchQueryDto): Promise<SiteSearchResponseDto> {
    const q = query.q.trim();
    const limit = query.limit ?? 4;

    const [composers, works, articles] = await Promise.allSettled([
      this.composers.findAll({ search: q, page: 1, limit }),
      this.works.search({ q, limit }),
      this.articles.searchArticles({ q, page: 1, limit }),
    ]);

    return {
      query: q,
      composers: composers.status === 'fulfilled' ? composers.value : [],
      works: works.status === 'fulfilled' ? works.value : [],
      articles:
        articles.status === 'fulfilled'
          ? articles.value.results.slice(0, limit)
          : [],
    };
  }
}
