import {
  blogSlug,
  copySlug,
  estimateReadTime,
  SLUG_PATTERN,
} from './article-text';

describe('blogSlug', () => {
  // As tags existentes na base, gravadas pelo legado: o algoritmo precisa dar
  // o mesmo slug, ou o upsert cria uma tag duplicada.
  it.each([
    ['frederic Chopin', 'frederic-chopin'],
    ['HIstoria do compositor', 'historia-do-compositor'],
    ['Tudo sobre', 'tudo-sobre'],
    ['romantico', 'romantico'],
  ])('%j dá o slug que o legado gravou (%j)', (name, slug) => {
    expect(blogSlug(name)).toBe(slug);
  });

  it('tira acento', () => {
    expect(blogSlug('Ópera Romântica')).toBe('opera-romantica');
  });

  // `createSlug`, dos scrapers, apagaria a pontuação e daria `bachs`.
  it('troca pontuação por hífen, como o legado', () => {
    expect(blogSlug("Bach's")).toBe('bach-s');
  });

  it('apara hífens das pontas', () => {
    expect(blogSlug('  --Ópera!! ')).toBe('opera');
  });

  it('nome sem letra nem número dá slug vazio', () => {
    expect(blogSlug('!!!')).toBe('');
  });
});

describe('SLUG_PATTERN', () => {
  it.each(['tudo-sobre-frederic-chopin', 'a', 'op-28-n-4'])(
    'aceita %j',
    (slug) => {
      expect(SLUG_PATTERN.test(slug)).toBe(true);
    },
  );

  it.each(['Com-Maiuscula', 'duplo--hifen', '-borda', 'com espaço', 'a/b'])(
    'recusa %j',
    (slug) => {
      expect(SLUG_PATTERN.test(slug)).toBe(false);
    },
  );
});

describe('copySlug', () => {
  it('segue a sequência do legado', () => {
    expect(copySlug('chopin', new Set())).toBe('chopin-copia');
    expect(copySlug('chopin', new Set(['chopin-copia']))).toBe(
      'chopin-copia-1',
    );
    expect(
      copySlug('chopin', new Set(['chopin-copia', 'chopin-copia-1'])),
    ).toBe('chopin-copia-2');
  });
});

describe('estimateReadTime', () => {
  it('arredonda para cima, a 200 palavras por minuto', () => {
    expect(estimateReadTime(1)).toBe(1);
    expect(estimateReadTime(200)).toBe(1);
    expect(estimateReadTime(201)).toBe(2);
  });

  // Medido na base: 4.473 palavras. A fórmula do legado, que contava o JSON,
  // dava 21 minutos.
  it('usa as palavras do texto: 4.473 dão 23 minutos', () => {
    expect(estimateReadTime(4473)).toBe(23);
  });

  it('sem texto, sem estimativa', () => {
    expect(estimateReadTime(0)).toBeNull();
  });
});
