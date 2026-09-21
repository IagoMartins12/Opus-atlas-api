import * as cheerio from 'cheerio';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ExternalPageFetcher } from './external-page.fetcher';
import { ImslpComposerScraper } from './imslp-composer.scraper';

const composerPage = () =>
  cheerio.load(`
    <html><body>
      <div class="cp_firsth">
        <h2><span class="mw-headline">Erik Satie</span></h2>
        (17 May 1866 – 1 July 1925)
      </div>
      <div class="cp_img"><img src="/images/satie.jpg"></div>
      <div class="cp_mainlinks">
        <span style="font-weight:normal">Nomes alternativos/Transliterações: Eric Satie</span>
      </div>
      <div class="cp_links"><a href="http://en.wikipedia.org/wiki/Erik_Satie">Wikipedia</a></div>
      <div id="catlinks"><a href="/wiki/Category:French_people">French people</a></div>
      <div id="mw-pages"><h2>Compositions by Satie</h2></div>
    </body></html>`);

describe('ImslpComposerScraper', () => {
  let scraper: ImslpComposerScraper;
  let prisma: { composer: { findFirst: jest.Mock; findMany: jest.Mock } };
  let fetcher: { load: jest.Mock };

  const URL = 'https://imslp.org/wiki/Category:Satie,_Erik';

  beforeEach(async () => {
    prisma = {
      composer: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    fetcher = {
      load: jest
        .fn()
        .mockResolvedValue({ $: composerPage(), url: URL, source: 'imslp' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImslpComposerScraper,
        { provide: PrismaService, useValue: prisma },
        { provide: ExternalPageFetcher, useValue: fetcher },
      ],
    }).compile();

    scraper = module.get(ImslpComposerScraper);
  });

  it('exige que a fonte seja o IMSLP', async () => {
    await scraper.scrape(URL);

    expect(fetcher.load).toHaveBeenCalledWith(URL, 'imslp');
  });

  it('monta a ficha do compositor', async () => {
    const composer = await scraper.scrape(URL);

    expect(composer).toMatchObject({
      name: 'Satie',
      fullName: 'Erik Satie',
      alternativeNames: 'Eric Satie',
      birthDate: '1866-05-17',
      deathDate: '1925-07-01',
      portraitUrl: 'https://imslp.org/images/satie.jpg',
      imslpId: 'Category:Satie,_Erik',
      wikipediaLink: 'https://en.wikipedia.org/wiki/Erik_Satie',
      nationality: 'Francês',
      primaryRole: 'Compositor',
      epochName: 'Romântico',
      hasValidImage: true,
    });
  });

  // A página de compositor do IMSLP não tem biografia; é a Wikipedia que tem.
  it('a biografia volta nula, como no legado', async () => {
    expect((await scraper.scrape(URL)).bio).toBeNull();
  });

  it('não grava nada', async () => {
    await scraper.scrape(URL);

    expect(Object.keys(prisma.composer)).toEqual(['findFirst', 'findMany']);
  });

  describe('casamento com o catálogo', () => {
    // A página escreve `Category:Satie,_Erik`; o catálogo guarda
    // `Category:Satie, Erik`. Medido no banco: 19.173 das 19.174 fichas estão
    // com espaço, então a busca exata praticamente nunca acertava.
    it('procura também a forma com espaço, que é a do catálogo', async () => {
      await scraper.scrape(URL);

      const buscados = prisma.composer.findFirst.mock.calls.map(
        (call) => call[0].where.imslpId,
      );

      expect(buscados).toContain('Category:Satie, Erik');
    });

    it('casa exato quando o catálogo tem a ficha', async () => {
      prisma.composer.findFirst.mockResolvedValue({
        id: 'comp-1',
        name: 'Satie',
        fullName: 'Erik Satie',
      });

      const composer = await scraper.scrape(URL);

      expect(composer.composerId).toBe('comp-1');
      expect(composer.composerCandidates).toEqual([]);
      expect(prisma.composer.findMany).not.toHaveBeenCalled();
    });

    it('um só candidato pelo sobrenome é escolhido', async () => {
      prisma.composer.findMany.mockResolvedValue([
        { id: 'comp-9', name: 'Satie', fullName: 'Erik Satie' },
      ]);

      expect((await scraper.scrape(URL)).composerId).toBe('comp-9');
    });

    // Sobrescrever a ficha do compositor errado troca dado bom por dado de
    // outra pessoa, e o erro fica invisível no catálogo.
    it('mais de um candidato significa nenhum escolhido', async () => {
      prisma.composer.findMany.mockResolvedValue([
        { id: 'a', name: 'Bach', fullName: 'Johann Sebastian Bach' },
        { id: 'b', name: 'Bach', fullName: 'Carl Philipp Emanuel Bach' },
      ]);

      const composer = await scraper.scrape(URL);

      expect(composer.composerId).toBeNull();
      expect(composer.composerCandidates).toHaveLength(2);
    });
  });
});
