import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExternalPageFetcher } from '../imslp/external-page.fetcher';
import {
  articleTitleOf,
  stripQuery,
  WikipediaComposerClient,
} from './wikipedia-composer.client';

describe('articleTitleOf', () => {
  it('lê o título do caminho', () => {
    expect(
      articleTitleOf(
        new URL('https://pt.wikipedia.org/wiki/Heitor_Villa-Lobos'),
      ),
    ).toBe('Heitor_Villa-Lobos');
  });

  it('lê o título do parâmetro, na forma antiga de endereço', () => {
    expect(
      articleTitleOf(
        new URL('https://pt.wikipedia.org/w/index.php?title=Bach'),
      ),
    ).toBe('Bach');
  });

  it('devolve nulo para a raiz', () => {
    expect(articleTitleOf(new URL('https://pt.wikipedia.org/'))).toBeNull();
  });
});

describe('stripQuery', () => {
  // A API acrescenta rastreio à URL da imagem (`?utm_source=...`).
  it('tira o rastreio que a própria API acrescenta', () => {
    expect(
      stripQuery('https://upload.wikimedia.org/a.jpg?utm_source=api'),
    ).toBe('https://upload.wikimedia.org/a.jpg');
  });

  it('devolve nulo sem imagem', () => {
    expect(stripQuery(null)).toBeNull();
  });
});

describe('WikipediaComposerClient', () => {
  const fetcher = { loadJson: jest.fn() };
  const client = new WikipediaComposerClient(
    fetcher as unknown as ExternalPageFetcher,
  );

  beforeEach(() => fetcher.loadJson.mockReset());

  const resposta = (data: unknown) => ({
    data,
    url: 'https://pt.wikipedia.org/w/api.php',
    source: 'wikipedia' as const,
  });

  const artigo = resposta({
    query: {
      pages: {
        '50303': {
          pageid: 50303,
          title: 'Heitor Villa-Lobos',
          extract: 'Heitor Villa-Lobos foi um compositor brasileiro.',
          original: { source: 'https://upload/a.jpg?utm_source=api' },
          pageprops: { wikibase_item: 'Q203514' },
        },
      },
    },
  });

  describe('article', () => {
    it('recusa endereço fora da lista de fontes', async () => {
      await expect(
        client.article('https://wikipedia.org.atacante.com/wiki/X'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(fetcher.loadJson).not.toHaveBeenCalled();
    });

    it('recusa endereço do IMSLP quando se espera Wikipedia', async () => {
      await expect(client.article('https://imslp.org/wiki/X')).rejects.toThrow(
        /IMSLP/,
      );
    });

    it('pergunta à API do idioma que a URL indica', async () => {
      fetcher.loadJson.mockResolvedValue(artigo);

      await client.article('https://pt.wikipedia.org/wiki/Heitor_Villa-Lobos');

      const [url, source] = fetcher.loadJson.mock.calls[0];
      expect(source).toBe('wikipedia');
      expect(url).toContain('https://pt.wikipedia.org/w/api.php?');
      expect(url).toContain('titles=Heitor_Villa-Lobos');
      expect(url).toContain('redirects=1');
    });

    it('monta a ficha do artigo', async () => {
      fetcher.loadJson.mockResolvedValue(artigo);

      const result = await client.article(
        'https://pt.wikipedia.org/wiki/Heitor_Villa-Lobos',
      );

      expect(result).toMatchObject({
        pageid: 50303,
        title: 'Heitor Villa-Lobos',
        wikidataId: 'Q203514',
        language: 'pt',
        portraitUrl: 'https://upload/a.jpg',
      });
    });

    it('avisa quando a Wikipedia não tem o artigo', async () => {
      fetcher.loadJson.mockResolvedValue(
        resposta({ query: { pages: { '-1': { missing: '' } } } }),
      );

      await expect(
        client.article('https://pt.wikipedia.org/wiki/Nao_Existe'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('recusa endereço que não aponta para artigo', async () => {
      await expect(
        client.article('https://pt.wikipedia.org/'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('person', () => {
    const entidade = (claims: unknown) =>
      resposta({ entities: { Q1339: { claims } } });

    it('lê nascimento, morte e país do Wikidata', async () => {
      fetcher.loadJson
        .mockResolvedValueOnce(
          entidade({
            P569: [
              {
                mainsnak: {
                  datavalue: {
                    value: { time: '+1685-03-21T00:00:00Z', precision: 11 },
                  },
                },
              },
            ],
            P570: [
              {
                mainsnak: {
                  datavalue: {
                    value: { time: '+1750-07-28T00:00:00Z', precision: 11 },
                  },
                },
              },
            ],
            P27: [
              {
                mainsnak: {
                  datavalue: {
                    value: { 'entity-type': 'item', id: 'Q696651' },
                  },
                },
              },
            ],
          }),
        )
        .mockResolvedValueOnce(
          resposta({
            entities: { Q696651: { labels: { pt: { value: 'Saxônia' } } } },
          }),
        );

      const person = await client.person('Q1339', 'pt');

      expect(person.birth).toMatchObject({ time: '+1685-03-21T00:00:00Z' });
      expect(person.death).toMatchObject({ time: '+1750-07-28T00:00:00Z' });
      expect(person.countryLabel).toBe('Saxônia');
    });

    it('busca o rótulo no Wikidata, não na Wikipedia', async () => {
      fetcher.loadJson
        .mockResolvedValueOnce(
          entidade({
            P27: [{ mainsnak: { datavalue: { value: { id: 'Q155' } } } }],
          }),
        )
        .mockResolvedValueOnce(
          resposta({
            entities: { Q155: { labels: { en: { value: 'Brazil' } } } },
          }),
        );

      await client.person('Q1339', 'pt');

      expect(fetcher.loadJson.mock.calls[0][1]).toBe('wikidata');
      expect(fetcher.loadJson.mock.calls[1][1]).toBe('wikidata');
    });

    it('sem país declarado, não busca rótulo nenhum', async () => {
      fetcher.loadJson.mockResolvedValue(entidade({}));

      const person = await client.person('Q1339', 'pt');

      expect(person.countryLabel).toBeNull();
      expect(fetcher.loadJson).toHaveBeenCalledTimes(1);
    });

    it('sobrevive a entidade sem as propriedades esperadas', async () => {
      fetcher.loadJson.mockResolvedValue(resposta({}));

      await expect(client.person('Q1339', 'pt')).resolves.toEqual({
        birth: null,
        death: null,
        countryLabel: null,
      });
    });
  });
});
