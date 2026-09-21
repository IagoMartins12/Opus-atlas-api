import {
  cleanDiscoveredTitle,
  discoveredWorksFrom,
  workUrlFromTitle,
} from './composer-works.parser';

describe('cleanDiscoveredTitle', () => {
  it('remove o compositor repetido no fim do título', () => {
    expect(cleanDiscoveredTitle('Sonata No.14 (Beethoven, Ludwig van)')).toBe(
      'Sonata No.14',
    );
  });

  it('decodifica entidades HTML', () => {
    expect(cleanDiscoveredTitle('Prelúdio &amp; Fuga')).toBe('Prelúdio & Fuga');
  });

  // A categoria do IMSLP mistura obras com páginas de ajuda, coletânea e
  // dedicatária; sem o filtro elas entrariam no catálogo como se fossem música.
  describe('descarta o que não é obra', () => {
    for (const titulo of [
      'Category:Pieces',
      'Special:Random',
      'Help:Contents',
      'Template:Work',
      'User:Alguém',
      'Chopin Collection',
      'Dedicatee pages',
    ]) {
      it(`recusa "${titulo}"`, () => {
        expect(cleanDiscoveredTitle(titulo)).toBeNull();
      });
    }
  });

  it('recusa título curto demais ou longo demais', () => {
    expect(cleanDiscoveredTitle('a')).toBeNull();
    expect(cleanDiscoveredTitle('x'.repeat(201))).toBeNull();
  });
});

describe('workUrlFromTitle', () => {
  it('troca espaço por sublinhado', () => {
    expect(workUrlFromTitle('Piano Sonata No.14 (Beethoven, Ludwig van)')).toBe(
      'https://imslp.org/wiki/Piano_Sonata_No.14_(Beethoven,_Ludwig_van)',
    );
  });

  it('codifica o que não é ASCII', () => {
    expect(workUrlFromTitle('Abbé Stadler')).toBe(
      'https://imslp.org/wiki/Abb%C3%A9_Stadler',
    );
  });
});

describe('discoveredWorksFrom', () => {
  const membro = (pageid: number, title: string) => ({ pageid, title });

  // O catálogo guarda o id numérico (205.985 das 207.880 obras), e era o nome
  // da página que a leitura HTML devolvia: as duas metades nunca se cruzavam.
  it('identifica a obra pelo id numérico da página', () => {
    expect(
      discoveredWorksFrom([
        membro(148524, 'Abbé Stadler, WoO 178 (Beethoven, Ludwig van)'),
      ]),
    ).toEqual([
      {
        title: 'Abbé Stadler, WoO 178',
        imslpId: '148524',
        imslpUrl:
          'https://imslp.org/wiki/Abb%C3%A9_Stadler,_WoO_178_(Beethoven,_Ludwig_van)',
      },
    ]);
  });

  it('descarta o que não é obra', () => {
    const works = discoveredWorksFrom([
      membro(1, 'Category:Piano pieces'),
      membro(2, 'Sonata (Bach, Johann)'),
    ]);

    expect(works.map((work) => work.title)).toEqual(['Sonata']);
  });

  it('não repete a mesma página', () => {
    expect(
      discoveredWorksFrom([
        membro(42, 'Sonata (Bach, Johann)'),
        membro(42, 'Sonata (Bach, Johann)'),
      ]),
    ).toHaveLength(1);
  });

  it('devolve vazio para categoria sem membros', () => {
    expect(discoveredWorksFrom([])).toEqual([]);
  });
});
