import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/api-key.decorator';
import { PublicCache } from '../common/decorators/public-cache.decorator';
import {
  SiteSearchQueryDto,
  SiteSearchResponseDto,
} from './dto/site-search.dto';
import { SiteSearchService } from './site-search.service';

@ApiTags('site-search')
@Controller('search')
export class SiteSearchController {
  constructor(private readonly siteSearch: SiteSearchService) {}

  @Public()
  @PublicCache({ maxAgeSeconds: 120, staleWhileRevalidateSeconds: 600 })
  @Get()
  @ApiOperation({
    summary: 'Unified site search: composers, works and blog articles',
    description:
      'Used by the header live search and the /search page. Each group is ' +
      'searched in parallel and capped at `limit` results.',
  })
  @ApiOkResponse({ type: SiteSearchResponseDto })
  search(@Query() query: SiteSearchQueryDto): Promise<SiteSearchResponseDto> {
    return this.siteSearch.search(query);
  }
}
