import {
  bioPrompt,
  cleanBio,
  hasBio,
  NO_BIO_MARKER,
  translationPrompt,
} from './composer-bio.prompt';

const LONG =
  'Frédéric Chopin foi um compositor e pianista polonês do romantismo.';

describe('prompt da biografia', () => {
  it('leva ao modelo tudo o que o catálogo sabe', () => {
    const prompt = bioPrompt({
      name: 'Chopin',
      fullName: 'Frédéric Chopin',
      alternativeNames: 'Fryderyk Szopen',
      birthDate: '1810',
      deathDate: '1849',
      epochName: 'Romântico',
      roleName: 'Compositor',
      nationality: 'Polonês',
      instruments: 'Piano',
    });

    expect(prompt).toContain('Escreva a biografia de Frédéric Chopin.');
    expect(prompt).toContain('- Outros nomes: Fryderyk Szopen');
    expect(prompt).toContain('- Nacionalidade: Polonês');
    expect(prompt).toContain('- Instrumentos: Piano');
    expect(prompt).toContain(`responda apenas ${NO_BIO_MARKER}`);
  });

  it('omite o que é vazio ou "Desconhecido"', () => {
    const prompt = bioPrompt({
      name: 'Anônimo',
      fullName: '  ',
      epochName: 'Desconhecido',
      nationality: null,
    });

    expect(prompt).toContain('Escreva a biografia de Anônimo.');
    expect(prompt).not.toContain('Período');
    expect(prompt).not.toContain('Nacionalidade');
  });

  it('sem dado nenhum além do nome, diz isso', () => {
    const prompt = bioPrompt({ name: '  ', fullName: '' });
    expect(prompt).toContain('- (nada além do nome)');
  });

  it('a tradução manda o texto como está', () => {
    expect(translationPrompt('texto')).toBe('texto');
  });
});

describe('cleanBio', () => {
  it('"não sei" do modelo vira null, em qualquer caixa', () => {
    expect(cleanBio('sem_biografia')).toBeNull();
    expect(cleanBio(`Desculpe. ${NO_BIO_MARKER}`)).toBeNull();
  });

  it('curto demais não é biografia', () => {
    expect(cleanBio('Compositor.')).toBeNull();
  });

  it('tira título, negrito e linhas em branco a mais', () => {
    expect(
      cleanBio(`# Chopin\n\n**${LONG}**\r\n\n\n\nSegundo parágrafo.`),
    ).toBe(`${LONG}\n\nSegundo parágrafo.`);
  });
});

describe('hasBio', () => {
  it('só conta a partir de 50 caracteres úteis', () => {
    expect(hasBio(LONG)).toBe(true);
    expect(hasBio(`   curta   `)).toBe(false);
    expect(hasBio(null)).toBe(false);
    expect(hasBio(undefined)).toBe(false);
  });
});
