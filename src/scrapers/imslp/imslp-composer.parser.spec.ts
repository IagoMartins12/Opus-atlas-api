import * as cheerio from 'cheerio';
import {
  determineRole,
  evaluatePageQuality,
  extractAlternativeNames,
  extractComposerCategories,
  extractComposerDates,
  extractComposerInstruments,
  extractComposerNationality,
  extractExternalLinks,
  extractNameAndFullName,
  extractPortraitUrl,
  extractWikipediaLink,
  parseFlexibleDate,
} from './imslp-composer.parser';

const page = (body: string) =>
  cheerio.load(`<html><body>${body}</body></html>`);

describe('extractNameAndFullName', () => {
  it('separa sobrenome e nome do identificador da página', () => {
    expect(extractNameAndFullName('Category:Satie,_Erik', page(''))).toEqual({
      name: 'Satie',
      fullName: 'Erik Satie',
    });
  });

  // O legado trocava o sublinhado por espaço **depois** do `trim`, e o
  // identificador traz `_Erik` depois da vírgula: o nome ia para o catálogo
  // como `" Erik Satie"`, com espaço na frente.
  it('não deixa espaço na frente do nome completo', () => {
    const { fullName } = extractNameAndFullName(
      'Category:Bach,_Johann_Sebastian',
      page(''),
    );

    expect(fullName).toBe('Johann Sebastian Bach');
    expect(fullName).not.toMatch(/^\s/);
  });

  it('identificador sem vírgula vira nome e sobrenome iguais', () => {
    expect(extractNameAndFullName('Category:Anonymous', page(''))).toEqual({
      name: 'Anonymous',
      fullName: 'Anonymous',
    });
  });

  // O cabeçalho traz o nome inteiro, com nomes do meio que o identificador
  // não tem.
  it('o cabeçalho da página vence quando é mais completo', () => {
    const $ = page(
      '<div class="cp_firsth"><h2><span class="mw-headline">Erik Alfred Leslie Satie</span></h2></div>',
    );

    expect(extractNameAndFullName('Category:Satie,_Erik', $).fullName).toBe(
      'Erik Alfred Leslie Satie',
    );
  });

  it('identificador vazio devolve ficha vazia', () => {
    expect(extractNameAndFullName('', page(''))).toEqual({
      name: '',
      fullName: '',
    });
  });
});

describe('extractAlternativeNames', () => {
  const bloco = (texto: string) =>
    page(
      `<div class="cp_mainlinks"><span style="font-weight:normal">${texto}</span></div>`,
    );

  it('lê os nomes alternativos em português', () => {
    expect(
      extractAlternativeNames(
        bloco('Nomes alternativos/Transliterações: Eric Satie'),
      ),
    ).toBe('Eric Satie');
  });

  it('lê os nomes alternativos em inglês', () => {
    expect(
      extractAlternativeNames(
        bloco('Alternative Names/Transliterations: Eric Satie'),
      ),
    ).toBe('Eric Satie');
  });

  it('devolve nulo quando a página não tem o bloco', () => {
    expect(extractAlternativeNames(page(''))).toBeNull();
  });

  it('devolve nulo quando o bloco não fala de nomes', () => {
    expect(extractAlternativeNames(bloco('Outra coisa qualquer'))).toBeNull();
  });
});

describe('extractPortraitUrl', () => {
  it('completa o endereço relativo', () => {
    expect(
      extractPortraitUrl(
        page('<div class="cp_img"><img src="/images/x.jpg"></div>'),
      ),
    ).toBe('https://imslp.org/images/x.jpg');
  });

  it('mantém o endereço absoluto', () => {
    expect(
      extractPortraitUrl(
        page('<div class="cp_img"><img src="https://imslp.org/a.jpg"></div>'),
      ),
    ).toBe('https://imslp.org/a.jpg');
  });

  // O IMSLP põe uma imagem de espaço reservado quando não tem retrato.
  it('recusa a imagem de "sem foto"', () => {
    expect(
      extractPortraitUrl(
        page(
          '<div class="cp_img"><img src="/Nocomposerphotoavailable.jpg"></div>',
        ),
      ),
    ).toBeNull();
  });

  it('devolve nulo sem imagem', () => {
    expect(extractPortraitUrl(page(''))).toBeNull();
  });
});

describe('extractComposerCategories', () => {
  // O legado varria o documento inteiro e arrastava a navegação do MediaWiki
  // junto — "View source", "History", e até o endereço de revisão da página.
  it('prefere o bloco de categorias da página', () => {
    const $ = page(`
      <a href="/wiki/Category:View_source">View source</a>
      <div id="catlinks">
        <a href="/wiki/Category:French_people">French people</a>
        <a href="/wiki/Category:Composers">Composers</a>
      </div>`);

    expect(extractComposerCategories($)).toBe('French people, Composers');
  });

  it('sem o bloco, cai para a varredura ampla', () => {
    const $ = page('<a href="/wiki/Category:Composers">Composers</a>');

    expect(extractComposerCategories($)).toBe('Composers');
  });

  it('devolve nulo quando não há categoria nenhuma', () => {
    expect(extractComposerCategories(page(''))).toBeNull();
  });
});

describe('extractWikipediaLink', () => {
  it('acha o link e o promove a HTTPS', () => {
    const $ = page(
      '<div class="cp_links"><a href="http://en.wikipedia.org/wiki/Satie">Wikipedia</a></div>',
    );

    expect(extractWikipediaLink($)).toBe('https://en.wikipedia.org/wiki/Satie');
  });

  it('devolve nulo sem o bloco de links', () => {
    expect(extractWikipediaLink(page(''))).toBeNull();
  });
});

describe('extractExternalLinks', () => {
  it('junta texto e endereço de cada item', () => {
    const $ = page(`
      <h2><span id="Links_externos">Links externos</span></h2>
      <div class="cp_links"><li><a href="https://x.org">Sítio</a></li></div>`);

    expect(extractExternalLinks($)).toBe('Sítio (https://x.org)');
  });

  it('devolve nulo sem a seção', () => {
    expect(extractExternalLinks(page(''))).toBeNull();
  });
});

describe('determineRole', () => {
  it('lê o papel principal e os demais das seções da listagem', () => {
    const $ = page(`
      <div id="mw-pages">
        <h2>Compositions by Bach</h2>
        <h2>Arrangements by Bach</h2>
        <h2>Works edited by Bach</h2>
      </div>`);

    expect(determineRole($)).toEqual({
      primaryRole: 'Compositor',
      roles: 'Arranjador, Editor',
    });
  });

  it('uma seção só não gera lista de demais papéis', () => {
    const $ = page('<div id="mw-pages"><h2>Compositions by X</h2></div>');

    expect(determineRole($)).toEqual({
      primaryRole: 'Compositor',
      roles: null,
    });
  });

  it('sem listagem, nenhum papel', () => {
    expect(determineRole(page(''))).toEqual({
      primaryRole: null,
      roles: null,
    });
  });
});

describe('evaluatePageQuality', () => {
  it('página vazia é de baixa qualidade', () => {
    const quality = evaluatePageQuality(page(''));

    expect(quality).toEqual({
      pageQuality: 'low',
      dataCompleteness: 0,
      hasValidImage: false,
    });
  });

  it('página completa é de alta qualidade', () => {
    const $ = page(`
      <div class="cp_firsth"><h2>Nome</h2>(1866 – 1925)${'x'.repeat(120)}</div>
      <div class="cp_img"><img src="/a.jpg"></div>
      <div class="cp_links"><a href="https://en.wikipedia.org/x">w</a></div>
      <div id="mw-pages"></div>
      <div class="cp_mainlinks"></div>`);

    const quality = evaluatePageQuality($);

    expect(quality.pageQuality).toBe('high');
    expect(quality.dataCompleteness).toBe(100);
    expect(quality.hasValidImage).toBe(true);
  });

  it('a imagem de "sem foto" não conta como imagem válida', () => {
    const $ = page(
      '<div class="cp_img"><img src="/Nocomposerphotoavailable.jpg"></div>',
    );

    expect(evaluatePageQuality($).hasValidImage).toBe(false);
  });
});

describe('parseFlexibleDate', () => {
  it('lê dia, mês e ano em inglês', () => {
    expect(parseFlexibleDate('17 May 1866')).toBe('1866-05-17');
  });

  it('lê dia, mês e ano em português', () => {
    expect(parseFlexibleDate('17 de maio de 1866')).toBe('1866-05-17');
  });

  // O legado completava o que faltava com `01`: quem só tinha o ano saía com
  // "1797-01-01", e essa data falsa ia para o catálogo e para a tela como
  // "1 de janeiro de 1797".
  it('só o ano devolve só o ano, sem inventar dia', () => {
    expect(parseFlexibleDate('1797')).toBe('1797');
  });

  it('mês sem dia devolve ano e mês', () => {
    expect(parseFlexibleDate('May 1866')).toBe('1866-05');
  });

  it('dia fora da faixa é descartado', () => {
    expect(parseFlexibleDate('47 May 1866')).toBe('1866-05');
  });

  it('texto sem ano devolve nulo', () => {
    expect(parseFlexibleDate('primavera')).toBeNull();
  });

  it('vazio devolve nulo', () => {
    expect(parseFlexibleDate(null)).toBeNull();
  });
});

describe('extractComposerDates', () => {
  const cabecalho = (texto: string) =>
    page(`<div class="cp_firsth">${texto}</div>`);

  it('lê nascimento e morte com dia e mês', () => {
    expect(
      extractComposerDates(cabecalho('Erik Satie (17 May 1866 – 1 July 1925)')),
    ).toEqual({ birthDate: '1866-05-17', deathDate: '1925-07-01' });
  });

  it('lê o par de anos', () => {
    expect(extractComposerDates(cabecalho('Alguém (1797-1828)'))).toEqual({
      birthDate: '1797',
      deathDate: '1828',
    });
  });

  it('descarta o local colado na data', () => {
    expect(
      extractComposerDates(
        cabecalho('X (Berlin, 31 January 1797 – Vienna, 28 November 1828)'),
      ),
    ).toEqual({ birthDate: '1797-01-31', deathDate: '1828-11-28' });
  });

  it('lê a forma "born ... died ..."', () => {
    expect(extractComposerDates(cabecalho('X (born 1797, died 1828)'))).toEqual(
      { birthDate: '1797', deathDate: '1828' },
    );
  });

  // Compositor vivo não ganha data de morte.
  it('só o nascimento quando não há segunda data', () => {
    expect(extractComposerDates(cabecalho('Philip Glass (b. 1937)'))).toEqual({
      birthDate: '1937',
      deathDate: null,
    });
  });

  it('sem cabeçalho, nenhuma data', () => {
    expect(extractComposerDates(page(''))).toEqual({
      birthDate: null,
      deathDate: null,
    });
  });
});

describe('extractComposerNationality', () => {
  // Medido na página real do Villa-Lobos: a categoria `PeopleNonPD-USandEU`
  // contém a subcadeia "usa", e o legado casava "USA" → Americano. O
  // compositor brasileiro está no catálogo como americano por causa disso.
  it('não confunde "USandEU" com "USA"', () => {
    const $ = page(`
      <div id="catlinks">
        <a href="/wiki/Category:PeopleNonPD-USandEU">PeopleNonPD-USandEU</a>
        <a href="/wiki/Category:Brazilian_people">Brazilian people</a>
      </div>`);

    expect(extractComposerNationality($)).toBe('Brasileiro');
  });

  it('lê do cabeçalho quando ele diz', () => {
    const $ = page('<div class="cp_firsth">French composer</div>');

    expect(extractComposerNationality($)).toBe('Francês');
  });

  it('devolve nulo quando nada diz', () => {
    expect(extractComposerNationality(page(''))).toBeNull();
  });
});

describe('extractComposerInstruments', () => {
  it('reconhece o que a página cita', () => {
    expect(
      extractComposerInstruments(page('<p>Piano works and for viola</p>')),
    ).toBe('Piano, Viola');
  });

  it('devolve nulo quando não reconhece nenhum', () => {
    expect(extractComposerInstruments(page('<p>nada</p>'))).toBeNull();
  });
});
