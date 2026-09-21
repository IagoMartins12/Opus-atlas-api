import { toJsonInput } from './json.util';

describe('toJsonInput', () => {
  it('repassa o objeto para o Prisma', () => {
    const value = { violino: 3, piano: 5 };
    expect(toJsonInput(value)).toEqual(value);
  });

  it('converte null e undefined em undefined (campo não escrito)', () => {
    expect(toJsonInput(null)).toBeUndefined();
    expect(toJsonInput(undefined)).toBeUndefined();
  });

  it('preserva objeto vazio, que é diferente de ausente', () => {
    expect(toJsonInput({})).toEqual({});
  });
});
