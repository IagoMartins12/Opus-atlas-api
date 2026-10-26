import {
  CatalogWork,
  changesFor,
  isComposersPage,
  matchPopularNames,
} from './popular-names';

const obra = (over: Partial<CatalogWork> = {}): CatalogWork => ({
  id: 'w1',
  title: 'Piano Sonata No.14, Op.27 No.2',
  imslpPermlink:
    'https://imslp.org/wiki/Piano_Sonata_No.14,_Op.27_No.2_(Beethoven,_Ludwig_van)',
  popularName: null,
  popularNameEn: null,
  famousParts: [],
  famousPartsEn: [],
  ...over,
});

const luar = {
  c: 'Beethoven,_Ludwig_van',
  t: '^Piano Sonata No\\.14, Op\\.27 No\\.2\\b',
  pt: 'Sonata ao Luar',
  en: 'Moonlight Sonata',
};

describe('nomes populares das obras', () => {
  it('casa pelo fim da página do IMSLP e pelo título', () => {
    const arranjo = obra({
      id: 'w2',
      imslpPermlink:
        'https://imslp.org/wiki/Moonlight_Sonata_(Beethoven,_Ludwig_van)_(Fulano,_Ciclano)',
    });
    const outra = obra({ id: 'w3', title: 'Piano Sonata No.15, Op.28' });
    const [m] = matchPopularNames([luar], () => [obra(), arranjo, outra]);
    // O arranjo de outra pessoa mora numa página com o nome dela no fim.
    expect(m.works.map((w) => w.id)).toEqual(['w1']);
  });

  it('a página com acento codificado também é do compositor', () => {
    expect(
      isComposersPage(
        'https://imslp.org/wiki/Études,_Op.10_(Chopin,_Fr%C3%A9d%C3%A9ric)',
        'Chopin,_Frédéric',
      ),
    ).toBe(true);
  });

  it('grava os nomes; não repete o título nem passa por cima da curadoria', () => {
    expect(changesFor(obra(), luar)).toEqual({
      popularName: 'Sonata ao Luar',
      popularNameEn: 'Moonlight Sonata',
    });
    // Prince Igor não precisa de nome popular em inglês.
    expect(
      changesFor(obra({ title: 'Prince Igor' }), {
        ...luar,
        pt: 'Príncipe Igor',
        en: 'Prince Igor',
      }),
    ).toEqual({ popularName: 'Príncipe Igor' });
    const editada = obra({ popularName: 'Ao Luar' });
    expect(changesFor(editada, luar)).toEqual({
      popularNameEn: 'Moonlight Sonata',
    });
    expect(changesFor(editada, luar, true).popularName).toBe('Sonata ao Luar');
  });

  it('as partes famosas vão para a coletânea, sem nome popular', () => {
    const estudos = obra({ title: 'Études, Op.10' });
    expect(
      changesFor(estudos, {
        c: 'Chopin,_Frédéric',
        t: '^Études, Op\\.10\\b',
        pt: null,
        en: null,
        partes: {
          pt: ['Estudo Revolucionário (nº 12)'],
          en: ['Revolutionary Étude (No.12)'],
        },
      }),
    ).toEqual({
      famousParts: ['Estudo Revolucionário (nº 12)'],
      famousPartsEn: ['Revolutionary Étude (No.12)'],
    });
  });
});
