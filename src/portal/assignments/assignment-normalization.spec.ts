import { ASSIGNMENT_PRIORITIES, ASSIGNMENT_TYPES } from './assignment-types';
import {
  ASSIGNMENT_NORMALIZATION,
  normalizeValue,
} from './assignment-normalization';

describe('normalizeValue', () => {
  it('valor já válido fica', () => {
    expect(normalizeValue('type', 'performance')).toEqual({
      value: 'performance',
      matched: true,
    });
  });

  it('maiúscula, espaço e acento', () => {
    expect(normalizeValue('type', '  Prática ')).toEqual({
      value: 'practice',
      matched: true,
    });
    expect(normalizeValue('priority', 'MÉDIA').value).toBe('medium');
    expect(normalizeValue('priority', 'Urgente').value).toBe('high');
  });

  // Não some em silêncio: o script avisa quando não houve correspondência.
  it('sem correspondência vai para o padrão, marcado', () => {
    expect(normalizeValue('type', 'qualquer')).toEqual({
      value: 'practice',
      matched: false,
    });
    expect(normalizeValue('priority', null)).toEqual({
      value: 'medium',
      matched: false,
    });
  });
});

// O script normaliza para estes valores; se o enum mudar e a normalização não,
// ela gravaria valor que o enum recusa na leitura.
describe('normalização presa ao enum', () => {
  it('os valores de destino são exatamente os do enum', () => {
    expect([...ASSIGNMENT_NORMALIZATION.type.values].sort()).toEqual(
      [...ASSIGNMENT_TYPES].sort(),
    );
    expect([...ASSIGNMENT_NORMALIZATION.priority.values].sort()).toEqual(
      [...ASSIGNMENT_PRIORITIES].sort(),
    );
  });
});
