import { parseLegacyBioCache } from './legacy-bio-cache';

describe('parseLegacyBioCache', () => {
  it('junta português e inglês pelo id no fim da chave', () => {
    const bios = parseLegacyBioCache({
      ptBr: {
        frederic_chopin_68600FB6DF23F271F94BB803: ' Texto pt ',
        sem_id: 'ignorado',
      },
      en: {
        chopin_68600fb6df23f271f94bb803: 'Text en',
        vazio_68600fb6df23f271f94bb804: '   ',
        numero_68600fb6df23f271f94bb805: 42,
      },
    });

    expect([...bios.entries()]).toEqual([
      ['68600fb6df23f271f94bb803', { pt: 'Texto pt', en: 'Text en' }],
    ]);
  });

  it('arquivo sem as seções é vazio', () => {
    expect(parseLegacyBioCache({}).size).toBe(0);
  });
});
