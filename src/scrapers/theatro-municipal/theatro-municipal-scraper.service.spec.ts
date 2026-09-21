import { TheatroMunicipalScraperService } from './theatro-municipal-scraper.service';

const BASE = 'https://theatromunicipal.org.br';

const listing = [
  '/eventos/don-carlo/',
  `${BASE}/eventos/recital/`,
  '/eventos/don-carlo/',
  '/eventos/sem-titulo',
  '/eventos/sem-data',
  '/eventos/quebrado',
  '/eventos/concerto-coral',
  // Página de categoria, não de evento.
  '/eventos/categoria/opera/',
]
  .map((href) => `<a href="${href}">evento</a>`)
  .join('');

const dates = (text: string) => `<div>Datas Disponíveis ${text}</div>`;

const pages: Record<string, string | Error> = {
  '/programacao/': listing,
  [`${BASE}/eventos/don-carlo/`]: `<h1>Ópera Don Carlo &#8211; Verdi</h1>${dates('18 de setembro de 2026 19:00 19 de setembro de 2026 17:00')}`,
  [`${BASE}/eventos/recital/`]: `<h1>Recital &amp; Canções</h1>${dates('1 de outubro de 2026 20:00')}`,
  [`${BASE}/eventos/sem-titulo`]: dates('2 de outubro de 2026 20:00'),
  [`${BASE}/eventos/sem-data`]: '<h1>Em breve</h1><div>Aguarde</div>',
  [`${BASE}/eventos/quebrado`]: new Error('ECONNRESET'),
  [`${BASE}/eventos/concerto-coral`]: `<h1>Coral Paulistano</h1>${dates('3 de outubro de 2026')}`,
};

describe('TheatroMunicipalScraperService', () => {
  let scraper: TheatroMunicipalScraperService;
  let get: jest.Mock;

  beforeEach(() => {
    scraper = new TheatroMunicipalScraperService();
    get = jest.fn(async (url: string) => {
      const page = pages[url];
      if (page instanceof Error) throw page;
      return { data: page ?? '' };
    });
    (scraper as unknown as { httpClient: { get: jest.Mock } }).httpClient = {
      get,
    };
  });

  it('lê a programação sem repetir e sem páginas de categoria', async () => {
    await scraper.scrapeEvents();

    const eventCalls = get.mock.calls.filter(
      ([url]) => url !== '/programacao/',
    );
    expect(eventCalls).toHaveLength(6);
    expect(eventCalls[0][1]).toEqual({ baseURL: undefined });
    expect(scraper.getState().eventsFound).toBe(6);
  });

  it('cada sessão vira um registro; falhas ficam no relatório', async () => {
    const progress = jest.fn();

    const events = await scraper.scrapeEvents(progress);

    expect(events.map((event) => event.title)).toEqual([
      'Ópera Don Carlo – Verdi (Sessão 1)',
      'Ópera Don Carlo – Verdi (Sessão 2)',
      'Recital & Canções',
      'Coral Paulistano',
    ]);
    expect(events[0]).toMatchObject({
      startDate: new Date(2026, 8, 18, 19, 0),
      startTime: '19:00',
      externalId: 'theatro-municipal-don-carlo-0',
      ticketUrl: `${BASE}/eventos/don-carlo/`,
      venueDetails: 'Theatro Municipal de São Paulo',
    });
    expect(events[0].slug).toContain('sessao-1');
    expect(events[1].externalId).toBe('theatro-municipal-don-carlo-1');
    expect(events[2]).toMatchObject({
      externalId: 'theatro-municipal-recital-0',
      startTime: '20:00',
    });
    expect(events[3].startTime).toBeNull();

    expect(scraper.getState().eventsScraped).toBe(4);
    expect(scraper.getState().errors).toEqual([
      `Evento sem título: ${BASE}/eventos/sem-titulo`,
      '"Em breve": nenhuma data na página',
      `${BASE}/eventos/quebrado: ECONNRESET`,
    ]);
    expect(progress).toHaveBeenCalledWith(10, 100, '6 eventos publicados');
    expect(progress).toHaveBeenLastCalledWith(100, 100, '4 sessões coletadas');
  });

  it('programação vazia termina sem erro', async () => {
    get.mockResolvedValueOnce({ data: '<p>Nada em cartaz</p>' });

    await expect(scraper.scrapeEvents()).resolves.toEqual([]);
    expect(scraper.getState()).toMatchObject({
      eventsFound: 0,
      eventsScraped: 0,
    });
  });
});
