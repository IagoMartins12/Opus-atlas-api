import * as cheerio from 'cheerio';
import { parseSeasonRange } from './cidade-das-artes/cidade-das-artes-scraper.service';
import { extractWixEvents } from './theatro-da-paz/theatro-da-paz-scraper.service';
import { looksLikeSquattedDomain } from './auditorio-ibirapuera/auditorio-ibirapuera-scraper.service';
import { normalizePautas } from './teatro-amazonas/teatro-amazonas-scraper.service';
import { extractSessions } from './theatro-municipal/theatro-municipal.parser';

describe('parseSeasonRange (Cidade das Artes)', () => {
  const setembro = new Date(2026, 8, 10);

  it('lê uma data única', () => {
    const range = parseSeasonRange('19/09', setembro);

    expect(range?.startDate).toEqual(new Date(2026, 8, 19));
    expect(range?.endDate).toBeNull();
  });

  // "15/07 a 04/10" lido em setembro: o espetáculo está em cartaz agora.
  // Jogar o início para o ano que vem porque 15/07 já passou punha a estreia
  // doze meses no futuro.
  it('temporada em cartaz mantém o início neste ano', () => {
    const range = parseSeasonRange('15/07 a 04/10', setembro);

    expect(range?.startDate).toEqual(new Date(2026, 6, 15));
    expect(range?.endDate).toEqual(new Date(2026, 9, 4));
  });

  it('data única já passada vai para o ano que vem', () => {
    expect(parseSeasonRange('05/03', setembro)?.startDate).toEqual(
      new Date(2027, 2, 5),
    );
  });

  it('temporada que vira o ano começa no ano anterior ao fim', () => {
    const range = parseSeasonRange('15/12 a 04/01', setembro);

    expect(range?.startDate.getFullYear()).toBe(2026);
    expect(range?.endDate?.getFullYear()).toBe(2027);
    expect(range!.startDate < range!.endDate!).toBe(true);
  });

  it('recusa texto sem data', () => {
    expect(parseSeasonRange('em breve', setembro)).toBeNull();
  });

  it('recusa mês impossível', () => {
    expect(parseSeasonRange('19/19', setembro)).toBeNull();
  });
});

describe('extractWixEvents (Theatro da Paz)', () => {
  const page = (json: string) =>
    `<html><body><script>{"events":${json}}</script></body></html>`;

  it('lê os eventos embutidos na página', () => {
    const events = extractWixEvents(
      page(
        '[{"id":"a","title":"Encanto do Círio III","scheduling":{"config":{"startDate":"2026-09-10T23:00:00.000Z"}}}]',
      ),
    );

    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Encanto do Círio III');
  });

  // O JSON vem escapado dentro do HTML.
  it('desfaz o escape de barra', () => {
    const events = extractWixEvents(
      page(
        '[{"id":"a","title":"X","location":{"formattedAddress":"Praça da República, S\\\\/N"}}]',
      ),
    );

    expect(events[0].location?.formattedAddress).toContain('S/N');
  });

  it('respeita colchetes dentro de texto', () => {
    const events = extractWixEvents(
      page(
        '[{"id":"a","title":"Concerto [gratuito]"},{"id":"b","title":"Outro"}]',
      ),
    );

    expect(events).toHaveLength(2);
    expect(events[0].title).toBe('Concerto [gratuito]');
  });

  // Casa sem programação publicada não é erro.
  it('página sem o bloco devolve lista vazia', () => {
    expect(extractWixEvents('<html><body>nada</body></html>')).toEqual([]);
  });

  it('bloco corrompido devolve lista vazia', () => {
    expect(
      extractWixEvents('<html>"events":[{ isto nao e json </html>'),
    ).toEqual([]);
  });
});

describe('looksLikeSquattedDomain (Auditório Ibirapuera)', () => {
  // Medido no domínio real: a página "programação" lista artigos sobre
  // linguagens de programação.
  it('reconhece o domínio reaproveitado por conteúdo de tecnologia', () => {
    expect(
      looksLikeSquattedDomain(
        'Qual é a linguagem de programação mais usada no mundo?',
      ),
    ).toBe(true);
  });

  // Foi o que aconteceu com a Sala Cecília Meireles.
  it('reconhece o domínio reaproveitado por casa de apostas', () => {
    expect(looksLikeSquattedDomain('Bônus de boas-vindas e cassino')).toBe(
      true,
    );
  });

  it('página de casa de espetáculo passa', () => {
    expect(
      looksLikeSquattedDomain(
        'Programação de setembro: Orquestra Sinfônica e recital de piano',
      ),
    ).toBe(false);
  });
});

describe('normalizePautas (Teatro Amazonas)', () => {
  it('aceita vetor', () => {
    expect(normalizePautas([{ title: 'X' }])).toHaveLength(1);
  });

  it('aceita mapa dentro de `pautas`', () => {
    expect(normalizePautas({ pautas: { a: { title: 'X' } } })).toHaveLength(1);
  });

  it('resposta inesperada devolve lista vazia', () => {
    expect(normalizePautas('erro')).toEqual([]);
  });
});

describe('extractSessions (Theatro Municipal)', () => {
  const page = (body: string) =>
    cheerio.load(`<html><body>${body}</body></html>`);

  it('lê data e hora sob o rótulo de datas', () => {
    const sessions = extractSessions(
      page('<div>Datas Disponíveis 12 de setembro de 2026 16:00</div>'),
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0].startDate).toEqual(new Date(2026, 8, 12, 16, 0));
    expect(sessions[0].startTime).toBe('16:00');
  });

  // "Ópera Don Carlo, Sessão 1 e 2" — cada sessão é um registro no calendário.
  it('lê várias sessões', () => {
    const sessions = extractSessions(
      page(
        '<div>Datas Disponíveis 18 de setembro de 2026 19:00 19 de setembro de 2026 17:00</div>',
      ),
    );

    expect(sessions).toHaveLength(2);
    expect(sessions[1].startTime).toBe('17:00');
  });

  it('data sem hora ainda vale', () => {
    const sessions = extractSessions(
      page('<div>Datas Disponíveis 1 de março de 2027</div>'),
    );

    expect(sessions[0].startDate).toEqual(new Date(2027, 2, 1));
    expect(sessions[0].startTime).toBeNull();
  });

  // Datas fora do bloco não são sessões — a página tem "publicado em" e o
  // rodapé com outras datas.
  it('ignora datas antes do rótulo', () => {
    expect(
      extractSessions(
        page('<div>Publicado em 8 de setembro de 2026</div><div>nada</div>'),
      ),
    ).toEqual([]);
  });

  it('página sem o rótulo devolve lista vazia', () => {
    expect(extractSessions(page('<div>Em breve</div>'))).toEqual([]);
  });
});
