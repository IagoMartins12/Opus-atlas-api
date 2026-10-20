import { SiteSearchService } from './site-search.service';

describe('SiteSearchService', () => {
  const composer = { id: 'c1', name: 'Chopin' };
  const work = { id: 'w1', title: 'Nocturnes, Op. 9' };
  const article = (id: string) => ({ id, title: `Article ${id}` });

  function build(overrides: {
    composers?: jest.Mock;
    works?: jest.Mock;
    articles?: jest.Mock;
  }) {
    const composers = {
      findAll: overrides.composers ?? jest.fn().mockResolvedValue([composer]),
    };
    const works = {
      search: overrides.works ?? jest.fn().mockResolvedValue([work]),
    };
    const articles = {
      searchArticles:
        overrides.articles ??
        jest.fn().mockResolvedValue({
          results: [article('a1'), article('a2'), article('a3')],
        }),
    };
    const service = new SiteSearchService(
      composers as never,
      works as never,
      articles as never,
    );
    return { service, composers, works, articles };
  }

  it('searches the three groups with the trimmed term and limit', async () => {
    const { service, composers, works, articles } = build({});

    const result = await service.search({ q: '  noturno ', limit: 2 });

    expect(composers.findAll).toHaveBeenCalledWith({
      search: 'noturno',
      page: 1,
      limit: 2,
    });
    expect(works.search).toHaveBeenCalledWith({ q: 'noturno', limit: 2 });
    expect(articles.searchArticles).toHaveBeenCalledWith({
      q: 'noturno',
      page: 1,
      limit: 2,
    });
    expect(result).toEqual({
      query: 'noturno',
      composers: [composer],
      works: [work],
      articles: [article('a1'), article('a2')],
    });
  });

  it('keeps the other groups when one search fails', async () => {
    const { service } = build({
      articles: jest.fn().mockRejectedValue(new Error('blog down')),
    });

    const result = await service.search({ q: 'bach' });

    expect(result.composers).toEqual([composer]);
    expect(result.works).toEqual([work]);
    expect(result.articles).toEqual([]);
  });
});
