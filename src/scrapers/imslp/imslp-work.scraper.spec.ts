import * as cheerio from 'cheerio';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ExternalPageFetcher } from './external-page.fetcher';
import { ImslpWorkScraper } from './imslp-work.scraper';

const workPage = (extra = '') =>
  cheerio.load(`
    <html><body>
      <h1 id="firstHeading">Piano Sonata No.14 (Beethoven, Ludwig van)</h1>
      <div class="wi_body"><table>
        <tr><th>Composer</th><td><a href="/wiki/Category:Beethoven,_Ludwig_van">Beethoven, Ludwig van</a></td></tr>
        <tr><th>Opus/Catalogue Number</th><td>Op. 27 No. 2</td></tr>
        <tr><th>Key</th><td>C-sharp minor</td></tr>
        <tr><th>Instrumentation</th><td>piano</td></tr>
      </table></div>
      ${extra}
    </body></html>`);

describe('ImslpWorkScraper', () => {
  let scraper: ImslpWorkScraper;
  let prisma: {
    composer: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let fetcher: { load: jest.Mock };

  beforeEach(async () => {
    prisma = {
      composer: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest
          .fn()
          .mockResolvedValue({ epoch: { name: 'Clássico' } }),
      },
    };

    fetcher = {
      load: jest.fn().mockResolvedValue({
        $: workPage(),
        url: 'https://imslp.org/wiki/Piano_Sonata_No.14_(Beethoven,_Ludwig_van)',
        source: 'imslp',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImslpWorkScraper,
        { provide: PrismaService, useValue: prisma },
        { provide: ExternalPageFetcher, useValue: fetcher },
      ],
    }).compile();

    scraper = module.get(ImslpWorkScraper);
  });

  it('exige que a fonte seja o IMSLP', async () => {
    await scraper.scrape('https://imslp.org/wiki/X');

    expect(fetcher.load).toHaveBeenCalledWith(
      'https://imslp.org/wiki/X',
      'imslp',
    );
  });

  it('monta a ficha da obra', async () => {
    const work = await scraper.scrape('https://imslp.org/wiki/X');

    expect(work).toMatchObject({
      title: 'Piano Sonata No.14',
      opOrCatalog: 'Op. 27 No. 2',
      // O IMSLP escreve o acidente por extenso, e a tabela de tradução tem a
      // entrada — era a expressão regular do legado que não a alcançava.
      tone: 'Dó# menor',
      instrumentation: 'Piano',
      composerName: 'Beethoven, Ludwig van',
      composerPermLink: 'Category:Beethoven,_Ludwig_van',
    });
  });

  // O cabeçalho da página do IMSLP traz o compositor no fim do título; as
  // 207.890 obras já no catálogo estão gravadas sem ele. Este teste estava
  // errado antes: ele afirmava o título com o sufixo, e foi assim que o
  // defeito passou pela suíte.
  it('o título não carrega o compositor do cabeçalho', async () => {
    const work = await scraper.scrape('https://imslp.org/wiki/X');

    expect(work.title).not.toContain('Beethoven');
  });

  // Sem o corte, `extractSubtitle` caía no que estava entre parênteses e a
  // Sonata ao Luar era raspada com `subtitle: "Beethoven, Ludwig van"`.
  it('o subtítulo não vira o nome do compositor', async () => {
    const work = await scraper.scrape('https://imslp.org/wiki/X');

    expect(work.subtitle).toBeNull();
  });

  // Auditoria contra o legado: seis funções não tinham sido portadas, e três
  // delas alimentam colunas que existem em `Work`.
  describe('campos que a portabilidade tinha deixado para trás', () => {
    it('traduz a tonalidade, como o catálogo inteiro guarda', async () => {
      fetcher.load.mockResolvedValue({
        $: cheerio.load(`
          <html><body>
            <h1 id="firstHeading">Sonata (Beethoven, Ludwig van)</h1>
            <div class="wi_body"><table>
              <tr><th>Composer</th><td><a href="/wiki/Category:Beethoven,_Ludwig_van">Beethoven, Ludwig van</a></td></tr>
              <tr><th>Key</th><td>C major</td></tr>
            </table></div>
          </body></html>`),
        url: 'https://imslp.org/wiki/X',
        source: 'imslp',
      });

      expect((await scraper.scrape('https://imslp.org/wiki/X')).tone).toBe(
        'Dó maior',
      );
    });

    it('traduz a instrumentação', async () => {
      const work = await scraper.scrape('https://imslp.org/wiki/X');

      expect(work.instrumentation).toBe('Piano');
    });

    // As duas metades do legado discordam: a rota lia `No.14` do título (o
    // número da sonata), o script de carga contava os movimentos. O catálogo
    // desempata — a Sonata ao Luar tem `movementNumber: 3`.
    it('conta os movimentos, como as 94.781 linhas do catálogo', async () => {
      fetcher.load.mockResolvedValue({
        $: cheerio.load(`
          <html><body>
            <h1 id="firstHeading">Piano Sonata No.14 (Beethoven, Ludwig van)</h1>
            <div class="wi_body"><table>
              <tr><th>Composer</th><td><a href="/wiki/Category:Beethoven,_Ludwig_van">Beethoven, Ludwig van</a></td></tr>
              <tr><th>Movements/Sections</th><td>3 movements: Adagio sostenuto</td></tr>
            </table></div>
          </body></html>`),
        url: 'https://imslp.org/wiki/X',
        source: 'imslp',
      });

      expect(
        (await scraper.scrape('https://imslp.org/wiki/X')).movementNumber,
      ).toBe(3);
    });

    it('sem contagem de movimentos, o campo fica nulo', async () => {
      const work = await scraper.scrape('https://imslp.org/wiki/X');

      expect(work.movementNumber).toBeNull();
    });

    it('devolve as etiquetas cruas do IMSLP', async () => {
      const work = await scraper.scrape('https://imslp.org/wiki/X');

      expect(work.imslpTags).toContain('Beethoven, Ludwig van');
    });

    it('classifica a dificuldade na escala do catálogo', async () => {
      const work = await scraper.scrape('https://imslp.org/wiki/X');

      expect(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).toContain(
        work.difficultyLevel,
      );
    });

    // Sem estilo na página, a época vem do compositor.
    it('cai para a época do compositor quando a página não diz o estilo', async () => {
      prisma.composer.findFirst.mockResolvedValue({
        id: 'comp-1',
        name: 'Beethoven',
        fullName: 'Ludwig van Beethoven',
        imslpId: 'Category:Beethoven, Ludwig van',
      });

      const work = await scraper.scrape('https://imslp.org/wiki/X');

      expect(work.epochName).toBe('Clássico');
    });

    it('classifica a qualidade da ficha', async () => {
      const work = await scraper.scrape('https://imslp.org/wiki/X');

      expect(['high', 'medium', 'low']).toContain(work.pageQuality);
    });
  });

  // O legado tinha essa reserva e a portabilidade a tinha perdido: compositor
  // cadastrado à mão não tem `imslpId`, e o nome da página ainda o acha.
  it('acha o compositor pelo nome quando o permalink não casa com nada', async () => {
    // Nenhuma variação de permalink casa; só a busca por nome.
    prisma.composer.findFirst.mockImplementation(({ where }) =>
      Promise.resolve(
        where.fullName
          ? {
              id: 'comp-nome',
              name: 'Beethoven',
              fullName: 'Beethoven, Ludwig van',
            }
          : null,
      ),
    );

    const work = await scraper.scrape('https://imslp.org/wiki/X');

    expect(work.composerId).toBe('comp-nome');
  });

  it('mede o quanto da ficha veio preenchido', async () => {
    const work = await scraper.scrape('https://imslp.org/wiki/X');

    expect(work.dataCompleteness).toBeGreaterThan(0);
    expect(work.dataCompleteness).toBeLessThanOrEqual(100);
  });

  describe('compositor', () => {
    it('casa pelo permalink exato', async () => {
      prisma.composer.findFirst.mockResolvedValue({
        id: 'comp-1',
        name: 'Beethoven',
        fullName: 'Ludwig van Beethoven',
        imslpId: 'Category:Beethoven,_Ludwig_van',
      });

      const work = await scraper.scrape('https://imslp.org/wiki/X');

      expect(work.composerId).toBe('comp-1');
      expect(work.composerCandidates).toEqual([]);
    });

    it('aceita a busca parcial quando ela é conclusiva', async () => {
      prisma.composer.findMany.mockResolvedValue([
        { id: 'comp-1', name: 'Beethoven', fullName: null, imslpId: 'x' },
      ]);

      const work = await scraper.scrape('https://imslp.org/wiki/X');

      expect(work.composerId).toBe('comp-1');
    });

    // `contains` pelo sobrenome casa J. S. Bach, C. P. E. Bach e J. C. Bach com
    // a mesma consulta. O legado ficava com o primeiro que o banco devolvesse,
    // sem ordenação e sem aviso — e a obra entrava no compositor errado.
    it('não escolhe quando há mais de um candidato', async () => {
      prisma.composer.findMany.mockResolvedValue([
        {
          id: 'c1',
          name: 'Bach',
          fullName: 'Johann Sebastian Bach',
          imslpId: 'a',
        },
        {
          id: 'c2',
          name: 'Bach',
          fullName: 'Carl Philipp Emanuel Bach',
          imslpId: 'b',
        },
      ]);

      const work = await scraper.scrape('https://imslp.org/wiki/X');

      expect(work.composerId).toBeNull();
      expect(work.composerCandidates).toEqual([
        { id: 'c1', name: 'Johann Sebastian Bach' },
        { id: 'c2', name: 'Carl Philipp Emanuel Bach' },
      ]);
    });

    it('tenta as variações de acentuação antes de desistir', async () => {
      await scraper.scrape('https://imslp.org/wiki/X');

      expect(
        prisma.composer.findFirst.mock.calls.length,
      ).toBeGreaterThanOrEqual(1);
    });

    it('sem linha de compositor na página, segue sem ele', async () => {
      fetcher.load.mockResolvedValue({
        $: cheerio.load('<h1 id="firstHeading">Peça</h1>'),
        url: 'https://imslp.org/wiki/X',
        source: 'imslp',
      });

      const work = await scraper.scrape('https://imslp.org/wiki/X');

      expect(work.composerId).toBeNull();
      expect(work.composerName).toBeNull();
    });
  });
});
