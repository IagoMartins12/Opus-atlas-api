import { correctedEpoch, epochByBirthYear } from './composer-epoch';

describe('epochByBirthYear', () => {
  it.each([
    [1685, 'Barroco'],
    [1756, 'Clássico'],
    [1797, 'Romântico'],
    [1882, 'Modernismo'],
    [1950, 'Contemporâneo'],
    [480, 'Medieval'],
  ])('nascido em %i é %s', (year, epoch) => {
    expect(epochByBirthYear(year)).toBe(epoch);
  });
});

describe('correctedEpoch', () => {
  it('época coerente com as datas não muda', () => {
    expect(correctedEpoch('Barroco', 1685)).toBeNull();
  });

  // Quem atravessa períodos fica onde está, dentro da folga.
  it('quem atravessa períodos fica como está', () => {
    expect(correctedEpoch('Clássico', 1770)).toBeNull(); // Beethoven
    expect(correctedEpoch('Romântico', 1770)).toBeNull();
    expect(correctedEpoch('Romântico', 1862)).toBeNull(); // Debussy
    expect(correctedEpoch('Modernismo', 1862)).toBeNull();
  });

  it('corrige a que cai fora da folga', () => {
    expect(correctedEpoch('Romântico', 1906)).toBe('Modernismo');
    expect(correctedEpoch('Modernismo', 1949)).toBe('Contemporâneo');
    expect(correctedEpoch('Contemporâneo', 840)).toBe('Medieval');
  });

  it('sem ano, ou com ano impossível, não mexe', () => {
    expect(correctedEpoch('Romântico', null)).toBeNull();
    expect(correctedEpoch('Romântico', 15)).toBeNull();
    expect(correctedEpoch('Romântico', 3020)).toBeNull();
  });
});
