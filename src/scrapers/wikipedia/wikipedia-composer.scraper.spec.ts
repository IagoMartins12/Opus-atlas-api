import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { WikipediaComposerClient } from './wikipedia-composer.client';
import { WikipediaComposerScraper } from './wikipedia-composer.scraper';
import { JULIAN_CALENDAR } from './wikipedia-composer.parser';

describe('WikipediaComposerScraper', () => {
  let scraper: WikipediaComposerScraper;
  let prisma: { composer: { findFirst: jest.Mock; findMany: jest.Mock } };
  let client: { article: jest.Mock; person: jest.Mock };

  const URL_BACH = 'https://en.wikipedia.org/wiki/Johann_Sebastian_Bach';

  beforeEach(async () => {
    prisma = {
      composer: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    client = {
      article: jest.fn().mockResolvedValue({
        pageid: 1339,
        title: 'Johann Sebastian Bach',
        summary: 'Johann Sebastian Bach was a German composer of the Baroque.',
        portraitUrl: 'https://upload/bach.jpg',
        wikidataId: 'Q1339',
        language: 'en',
        url: URL_BACH,
      }),
      person: jest.fn().mockResolvedValue({
        birth: {
          time: '+1685-03-21T00:00:00Z',
          precision: 11,
          calendarmodel: JULIAN_CALENDAR,
        },
        death: { time: '+1750-07-28T00:00:00Z', precision: 11 },
        countryLabel: 'Germany',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WikipediaComposerScraper,
        { provide: PrismaService, useValue: prisma },
        { provide: WikipediaComposerClient, useValue: client },
      ],
    }).compile();

    scraper = module.get(WikipediaComposerScraper);
  });

  it('monta a ficha do compositor', async () => {
    const composer = await scraper.scrape(URL_BACH);

    expect(composer).toMatchObject({
      name: 'Bach',
      fullName: 'Johann Sebastian Bach',
      birthDate: '1685-03-21 (juliano)',
      deathDate: '1750-07-28',
      nationality: 'Alemão',
      epochName: 'Barroco',
      wikipediaLink: URL_BACH,
    });
  });

  it('diz de onde cada metade veio', async () => {
    const composer = await scraper.scrape(URL_BACH);

    expect(composer.sources).toEqual({
      wikipedia: URL_BACH,
      wikidata: 'https://www.wikidata.org/wiki/Q1339',
    });
  });

  // Um artigo sem item no Wikidata ainda dá nome, resumo e retrato; o que
  // falta volta nulo e a completude cai, que é a informação certa para quem
  // revisa.
  it('artigo sem item no Wikidata ainda produz ficha', async () => {
    client.article.mockResolvedValue({
      pageid: 7,
      title: 'Compositor Obscuro',
      summary: 'Foi um compositor brasileiro do século XX.',
      portraitUrl: null,
      wikidataId: null,
      language: 'pt',
      url: 'https://pt.wikipedia.org/wiki/Compositor_Obscuro',
    });

    const composer = await scraper.scrape(
      'https://pt.wikipedia.org/wiki/Compositor_Obscuro',
    );

    expect(client.person).not.toHaveBeenCalled();
    expect(composer.birthDate).toBeNull();
    expect(composer.sources.wikidata).toBeNull();
    expect(composer.dataCompleteness).toBeLessThan(100);
  });

  it('não grava nada', async () => {
    await scraper.scrape(URL_BACH);

    expect(Object.keys(prisma.composer)).toEqual(['findFirst', 'findMany']);
  });

  describe('casamento com o catálogo', () => {
    it('casa pelo nome completo, sem diferenciar caixa', async () => {
      prisma.composer.findFirst.mockResolvedValue({
        id: 'comp-1',
        name: 'Bach',
        fullName: 'Johann Sebastian Bach',
      });

      const composer = await scraper.scrape(URL_BACH);

      expect(composer.composerId).toBe('comp-1');
      expect(composer.composerCandidates).toEqual([]);
      expect(prisma.composer.findFirst.mock.calls[0][0].where.fullName).toEqual(
        {
          equals: 'Johann Sebastian Bach',
          mode: 'insensitive',
        },
      );
    });

    it('um só candidato pelo sobrenome é escolhido', async () => {
      prisma.composer.findMany.mockResolvedValue([
        { id: 'comp-9', name: 'Bach', fullName: 'Johann Sebastian Bach' },
      ]);

      expect((await scraper.scrape(URL_BACH)).composerId).toBe('comp-9');
    });

    // Sobrescrever a ficha do compositor errado troca dado bom por dado de
    // outra pessoa, e o erro fica invisível no catálogo.
    it('mais de um candidato significa nenhum escolhido', async () => {
      prisma.composer.findMany.mockResolvedValue([
        { id: 'a', name: 'Bach', fullName: 'Johann Sebastian Bach' },
        { id: 'b', name: 'Bach', fullName: 'Carl Philipp Emanuel Bach' },
      ]);

      const composer = await scraper.scrape(URL_BACH);

      expect(composer.composerId).toBeNull();
      expect(composer.composerCandidates).toEqual([
        { id: 'a', name: 'Johann Sebastian Bach' },
        { id: 'b', name: 'Carl Philipp Emanuel Bach' },
      ]);
    });

    it('nenhum candidato deixa a ficha sem compositor', async () => {
      const composer = await scraper.scrape(URL_BACH);

      expect(composer.composerId).toBeNull();
      expect(composer.composerCandidates).toEqual([]);
    });
  });
});
