import { ExternalPageFetcher } from './external-page.fetcher';
import { ImslpApiClient, nextCursor, pagesOf } from './imslp-api.client';

describe('nextCursor', () => {
  it('lê a forma moderna do MediaWiki', () => {
    expect(nextCursor({ continue: { gcmcontinue: 'abc' } })).toBe('abc');
  });

  // O IMSLP roda um MediaWiki anterior à 1.26. Conferido contra o servidor
  // real: ele devolveu `query-continue` e nenhum `continue`. Ler só a forma
  // moderna faria a paginação parar calada na primeira página.
  it('lê a forma antiga, que é a que o IMSLP usa', () => {
    expect(
      nextCursor({
        'query-continue': { categorymembers: { gcmcontinue: 'page|X|123' } },
      }),
    ).toBe('page|X|123');
  });

  it('devolve nulo quando a categoria acabou', () => {
    expect(nextCursor({ query: { pages: {} } })).toBeNull();
  });
});

describe('pagesOf', () => {
  it('lê o mapa de páginas', () => {
    expect(
      pagesOf({ query: { pages: { '42': { pageid: 42, title: 'Sonata' } } } }),
    ).toEqual([{ pageid: 42, title: 'Sonata' }]);
  });

  // Página que o MediaWiki não conhece entra no mapa com chave negativa e sem
  // `pageid`; sem o descarte ela viraria uma obra sem identificador.
  it('descarta entrada sem id', () => {
    expect(
      pagesOf({ query: { pages: { '-1': { title: 'Inexistente' } } } }),
    ).toEqual([]);
  });

  it('sobrevive a resposta sem a chave de páginas', () => {
    expect(pagesOf({})).toEqual([]);
  });
});

describe('ImslpApiClient', () => {
  const fetcher = { loadJson: jest.fn() };
  const client = new ImslpApiClient(fetcher as unknown as ExternalPageFetcher);

  beforeEach(() => fetcher.loadJson.mockReset());

  const pagina = (
    membros: { pageid: number; title: string }[],
    extra: Record<string, unknown> = {},
  ) => ({
    data: {
      query: {
        pages: Object.fromEntries(membros.map((m) => [String(m.pageid), m])),
        ...extra,
      },
    },
    url: 'https://imslp.org/api.php',
    source: 'imslp' as const,
  });

  const comCursor = (
    membros: { pageid: number; title: string }[],
    cursor: string,
  ) => {
    const base = pagina(membros);

    return {
      ...base,
      data: {
        ...base.data,
        'query-continue': { categorymembers: { gcmcontinue: cursor } },
      },
    };
  };

  it('pede à fonte certa, com o nome da categoria', async () => {
    fetcher.loadJson.mockResolvedValue(pagina([]));

    await client.listCategoryMembers('Category:Bach, Johann Sebastian');

    const [url, source] = fetcher.loadJson.mock.calls[0];
    expect(source).toBe('imslp');
    expect(url).toContain('https://imslp.org/api.php?');
    expect(url).toContain('gcmtitle=Category%3ABach%2C+Johann+Sebastian');
    expect(url).toContain('gcmtype=page');
  });

  // Só o `generator` aceita `redirects=1`, e sem ele o redirecionamento é
  // devolvido com o próprio id — que nunca casa com o que a importação grava.
  it('pede ao MediaWiki que resolva os redirecionamentos', async () => {
    fetcher.loadJson.mockResolvedValue(pagina([]));

    await client.listCategoryMembers('Category:X');

    const [url] = fetcher.loadJson.mock.calls[0];
    expect(url).toContain('generator=categorymembers');
    expect(url).toContain('redirects=1');
  });

  // Medido contra o IMSLP: Bach tem 1.431 obras em 3 chamadas de 500. A
  // leitura anterior via as 200 primeiras da listagem HTML e parava ali.
  it('segue a paginação até o fim', async () => {
    fetcher.loadJson
      .mockResolvedValueOnce(comCursor([{ pageid: 1, title: 'A' }], 'c1'))
      .mockResolvedValueOnce(comCursor([{ pageid: 2, title: 'B' }], 'c2'))
      .mockResolvedValueOnce(pagina([{ pageid: 3, title: 'C' }]));

    const result = await client.listCategoryMembers('Category:X');

    expect(fetcher.loadJson).toHaveBeenCalledTimes(3);
    expect(result.members).toHaveLength(3);
    expect(result.truncated).toBe(false);
  });

  it('manda o cursor recebido na chamada seguinte', async () => {
    fetcher.loadJson
      .mockResolvedValueOnce(comCursor([{ pageid: 1, title: 'A' }], 'page|X|9'))
      .mockResolvedValueOnce(pagina([]));

    await client.listCategoryMembers('Category:X');

    expect(fetcher.loadJson.mock.calls[1][0]).toContain(
      'gcmcontinue=page%7CX%7C9',
    );
  });

  // Dois redirecionamentos podem apontar para a mesma página de destino.
  it('não repete a página que aparece duas vezes', async () => {
    fetcher.loadJson
      .mockResolvedValueOnce(comCursor([{ pageid: 7, title: 'Sonata' }], 'c1'))
      .mockResolvedValueOnce(pagina([{ pageid: 7, title: 'Sonata' }]));

    expect(
      (await client.listCategoryMembers('Category:X')).members,
    ).toHaveLength(1);
  });

  // Uma categoria não pode virar uma sessão inteira de requisições — mas quem
  // lê precisa saber que a lista não é tudo, porque decide importar por ela.
  it('para no teto de chamadas e avisa que truncou', async () => {
    fetcher.loadJson.mockImplementation(() =>
      Promise.resolve(
        comCursor([{ pageid: Math.random(), title: 'A' }], 'sempre-tem-mais'),
      ),
    );

    const result = await client.listCategoryMembers('Category:X');

    expect(fetcher.loadJson).toHaveBeenCalledTimes(20);
    expect(result.truncated).toBe(true);
  });

  it('sobrevive a resposta sem a chave de páginas', async () => {
    fetcher.loadJson.mockResolvedValue({
      data: {},
      url: 'https://imslp.org/api.php',
      source: 'imslp' as const,
    });

    await expect(client.listCategoryMembers('Category:X')).resolves.toEqual({
      members: [],
      truncated: false,
    });
  });
});
