import {
  cleanNameForComparison,
  extractImslpId,
  generateNameVariations,
  isSimilarName,
} from './name-matching.util';

describe('cleanNameForComparison', () => {
  it('remove parênteses e vírgulas', () => {
    expect(cleanNameForComparison('Mozart, (Wolfgang) Amadeus')).toBe(
      'Mozart Wolfgang Amadeus',
    );
  });

  it('troca sublinhado por espaço, como vem das URLs do IMSLP', () => {
    expect(cleanNameForComparison('Beethoven,_Ludwig_van')).toBe(
      'Beethoven Ludwig van',
    );
  });

  it('colapsa espaços repetidos e apara as bordas', () => {
    expect(cleanNameForComparison('  Johann   Sebastian  Bach ')).toBe(
      'Johann Sebastian Bach',
    );
  });
});

describe('isSimilarName', () => {
  it('reconhece o mesmo nome com caixa diferente', () => {
    expect(
      isSimilarName('Wolfgang Amadeus Mozart', 'wolfgang amadeus mozart'),
    ).toBe(true);
  });

  // O caso que motiva a comparação por conjunto de palavras: o IMSLP grava
  // "Sobrenome, Nome" e o formulário recebe "Nome Sobrenome".
  it('reconhece a inversão do formato de catálogo', () => {
    expect(
      isSimilarName('Mozart, Wolfgang Amadeus', 'Wolfgang Amadeus Mozart'),
    ).toBe(true);
  });

  it('tolera um nome do meio a mais', () => {
    expect(isSimilarName('Johann Sebastian Bach', 'Johann Bach')).toBe(true);
  });

  it('não confunde compositores que só compartilham o sobrenome', () => {
    expect(
      isSimilarName('Johann Sebastian Bach', 'Carl Philipp Emanuel Bach'),
    ).toBe(false);
  });

  it('não confunde compositores diferentes', () => {
    expect(
      isSimilarName('Ludwig van Beethoven', 'Wolfgang Amadeus Mozart'),
    ).toBe(false);
  });

  // Partículas aparecem em nomes de pessoas distintas e só adicionariam ruído.
  it('ignora partículas curtas na comparação', () => {
    expect(isSimilarName('Ludwig van Beethoven', 'Beethoven, Ludwig van')).toBe(
      true,
    );
  });

  it('devolve falso quando algum dos nomes está ausente', () => {
    expect(isSimilarName(null, 'Mozart')).toBe(false);
    expect(isSimilarName('Mozart', undefined)).toBe(false);
    expect(isSimilarName('', '')).toBe(false);
  });
});

describe('generateNameVariations', () => {
  it('gera a forma de catálogo, a reduzida e a de iniciais', () => {
    const variations = generateNameVariations('Wolfgang Amadeus Mozart');

    expect(variations).toContain('Mozart, Wolfgang Amadeus');
    expect(variations).toContain('Wolfgang Mozart');
    expect(variations).toContain('W. A. Mozart');
  });

  it('não repete o próprio nome de entrada', () => {
    expect(generateNameVariations('Wolfgang Amadeus Mozart')).not.toContain(
      'Wolfgang Amadeus Mozart',
    );
  });

  it('devolve lista vazia para nome de uma palavra só', () => {
    expect(generateNameVariations('Mozart')).toEqual([]);
  });

  it('não gera duplicatas', () => {
    const variations = generateNameVariations('Ludwig van Beethoven');
    expect(new Set(variations).size).toBe(variations.length);
  });
});

describe('extractImslpId', () => {
  it('extrai o identificador de uma URL de categoria', () => {
    expect(
      extractImslpId(
        'https://imslp.org/wiki/Category:Mozart,_Wolfgang_Amadeus',
      ),
    ).toBe('Category:Mozart,_Wolfgang_Amadeus');
  });

  it('decodifica caracteres escapados', () => {
    expect(
      extractImslpId('https://imslp.org/wiki/Sonata_No.1_%28Bach%29'),
    ).toBe('Sonata_No.1_(Bach)');
  });

  // Escape malformado não pode derrubar a checagem de duplicata: o trecho cru
  // ainda serve para comparar.
  it('devolve o trecho cru quando o escape é inválido', () => {
    expect(extractImslpId('https://imslp.org/wiki/Bad%ZZ')).toBe('Bad%ZZ');
  });

  it('devolve null para URL sem o segmento /wiki/', () => {
    expect(extractImslpId('https://exemplo.com/compositor/mozart')).toBeNull();
  });
});
