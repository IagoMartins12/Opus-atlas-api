import { OsespScraperService } from './osesp-scraper.service';

const BASE = 'https://osesp.art.br';
const LIST = `${BASE}/osesp/concertos-ingressos`;
const season = (page: number) =>
  `${BASE}/osesp/pt/temporada-osesp?pageconcerts=${page}`;

const card = (href: string) =>
  `<div class="card"><a href="${href}">Ver concerto</a></div>`;

const fullEvent = `
<div class="hero"><img src="/img/capa.jpg"></div>
<header class="article-header"><h1 class="text-title--1">Beethoven e a Fantástica de Berlioz</h1></header>
<div class="article-details">
  <div>Data: <span class="first-uppercase">12 de setembro de 2026</span></div>
  <div>Horário: <span class="first-uppercase">20h00</span></div>
  <div>Local: <a>Sala São Paulo — Sala de Concertos</a></div>
  <div>Preço: Gratuito</div>
  <a class="btn primary" href="https://ingressos.example/12">Retirar ingresso</a>
</div>
<section class="article-program">
  <h2>Programa</h2>
  <p>LUDWIG VAN BEETHOVEN Sinfonia nº 5 em dó menor, com a Orquestra Sinfônica do Estado de São Paulo.</p>
</section>`;

const detailsWithDate = (date: string, extra = '') =>
  `<div class="article-details"><div>Data: <span class="first-uppercase">${date}</span></div></div>${extra}`;

type Internals = {
  fetchWithRetry: (url: string) => Promise<string>;
  delay: (ms?: number) => Promise<void>;
  scrapeEventDetails: (url: string) => Promise<Record<string, unknown> | null>;
  scrapeSeasonEvents: () => Promise<string[]>;
};

describe('OsespScraperService', () => {
  let scraper: OsespScraperService;
  let internals: Internals;
  let fetch: jest.SpyInstance;

  const serve = (pages: Record<string, string | Error>) =>
    fetch.mockImplementation(async (url: string) => {
      const page = pages[url];
      if (page instanceof Error) throw page;
      return page ?? '<html></html>';
    });

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    scraper = new OsespScraperService();
    internals = scraper as unknown as Internals;
    fetch = jest.spyOn(internals, 'fetchWithRetry');
    jest.spyOn(internals, 'delay').mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('declara a Sala São Paulo', () => {
    expect(scraper.getConfig()).toMatchObject({
      venueSlug: 'sala-sao-paulo',
      venue: { city: 'São Paulo', shortName: 'OSESP' },
    });
  });

  it('junta a lista e a temporada sem repetir, e segue quando um evento falha', async () => {
    serve({
      [LIST]:
        card('/concerto/a') +
        card(`${BASE}/concerto/b`) +
        card('/concerto/a') +
        card('https://outro.site/concerto/x') +
        '<div class="card"><a href="/noticia/1">notícia</a></div>',
      [season(1)]: card('/concerto/b') + card('/concerto/c'),
      [season(2)]: '',
      [`${BASE}/concerto/a`]: fullEvent,
      [`${BASE}/concerto/b`]: '<h1>Sem data</h1>',
      [`${BASE}/concerto/c`]: new Error('503'),
    });
    const progress = jest.fn();

    const events = await scraper.scrapeEvents(progress);

    expect(events).toHaveLength(1);
    expect(progress).toHaveBeenCalledWith(
      25,
      100,
      '3 eventos únicos encontrados',
    );
    expect(progress).toHaveBeenCalledWith(
      100,
      100,
      'Processando evento 3/3...',
    );
    expect(scraper.getState()).toMatchObject({
      eventsFound: 3,
      eventsScraped: 1,
    });
    expect(scraper.getState().errors).toEqual([
      'Error processing event 3: 503',
    ]);
    // Link de outro domínio e card sem concerto não entram.
    expect(fetch).not.toHaveBeenCalledWith('https://outro.site/concerto/x');
  });

  it('monta o evento completo da página', async () => {
    serve({ [`${BASE}/concerto/a`]: fullEvent });

    const event = await internals.scrapeEventDetails(`${BASE}/concerto/a`);

    expect(event).toMatchObject({
      title: 'Beethoven e a Fantástica de Berlioz',
      startDate: new Date(2026, 8, 12),
      startTime: '20h00',
      endDate: null,
      venueDetails: 'Sala São Paulo — Sala de Concertos',
      ticketUrl: 'https://ingressos.example/12',
      externalUrl: `${BASE}/concerto/a`,
      ticketInfo: 'Entrada gratuita',
      imageUrl: `${BASE}/img/capa.jpg`,
      externalId: expect.stringMatching(/^osesp-.+-\d+$/),
    });
    expect(event?.program).toContain('BEETHOVEN Sinfonia');
    expect(event?.program).not.toContain('Programa');
    // Berlioz aparece só no título, não no programa: é falso positivo.
    expect(event?.composerNames).toContain('Beethoven');
    expect(event?.composerNames).not.toContain('Berlioz');
  });

  it('sem cabeçalho, programa, local, preço ou ingresso usa o que houver', async () => {
    serve({
      [`${BASE}/concerto/r`]: `
        <div class="hero"><img src="https://cdn.example/foto.jpg"></div>
        <article><h1>Recital de Piano</h1><p>Um recital com obras do repertório romântico para piano solo, em uma única noite.</p></article>
        ${detailsWithDate('3 de outubro de 2026')}`,
    });

    const event = await internals.scrapeEventDetails(`${BASE}/concerto/r`);

    expect(event).toMatchObject({
      title: 'Recital de Piano',
      description: expect.stringContaining('repertório romântico'),
      startDate: new Date(2026, 9, 3),
      startTime: null,
      venueDetails: 'Sala São Paulo',
      ticketUrl: `${BASE}/concerto/r`,
      ticketInfo: null,
      imageUrl: 'https://cdn.example/foto.jpg',
      program: null,
    });
  });

  it('sem h1, o título vem do <title>; sem imagem, fica nulo', async () => {
    serve({
      [`${BASE}/concerto/t`]: `<html><head><title>Concerto de Câmara</title></head><body>${detailsWithDate('5 de maio de 2027')}</body></html>`,
    });

    const event = await internals.scrapeEventDetails(`${BASE}/concerto/t`);

    expect(event).toMatchObject({
      title: 'Concerto de Câmara',
      imageUrl: null,
    });
  });

  it.each([
    ['mês que não existe', '12 de brumário de 2026'],
    ['texto sem data', 'em breve'],
  ])('%s: o evento é pulado', async (_, date) => {
    serve({
      [`${BASE}/concerto/d`]: `<h1>Concerto</h1>${detailsWithDate(date)}`,
    });

    await expect(
      internals.scrapeEventDetails(`${BASE}/concerto/d`),
    ).resolves.toBeNull();
  });

  it('erro numa página da temporada encerra a paginação com o que já veio', async () => {
    serve({
      [season(1)]: card('/concerto/1'),
      [season(2)]: new Error('timeout'),
    });

    await expect(internals.scrapeSeasonEvents()).resolves.toEqual([
      `${BASE}/concerto/1`,
    ]);
  });

  it('para na vigésima página da temporada', async () => {
    fetch.mockImplementation(async (url: string) =>
      card(`/concerto/${url.split('=')[1]}`),
    );

    const urls = await internals.scrapeSeasonEvents();

    expect(urls).toHaveLength(20);
    expect(fetch).toHaveBeenCalledTimes(20);
  });

  it('falha na lista principal derruba a rodada e avisa o progresso', async () => {
    serve({ [LIST]: new Error('fora do ar') });
    const progress = jest.fn();

    await expect(scraper.scrapeEvents(progress)).rejects.toThrow('fora do ar');
    expect(progress).toHaveBeenLastCalledWith(0, 100, 'Erro: fora do ar');
  });
});
