import { instrumentKind } from './instrument-kind';

describe('instrumentKind', () => {
  it('tells instruments, ensembles and placeholders apart', () => {
    expect(instrumentKind('Piano')).toBe('instrument');
    expect(instrumentKind('Soprano')).toBe('instrument');
    expect(instrumentKind('Orquestra')).toBe('ensemble');
    expect(instrumentKind('Quarteto de Cordas')).toBe('ensemble');
    expect(instrumentKind('Desconhecido')).toBe('none');
    expect(instrumentKind('Partes')).toBe('none');
  });
});
