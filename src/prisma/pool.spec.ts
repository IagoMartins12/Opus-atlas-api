import {
  DEFAULT_MAX_POOL_SIZE,
  DEFAULT_MIN_POOL_SIZE,
  describePool,
  withPoolSize,
} from './pool';

describe('withPoolSize', () => {
  it('acrescenta o dimensionamento quando a URL não o traz', () => {
    const url = new URL(withPoolSize('mongodb://localhost:27017/opus'));

    expect(url.searchParams.get('maxPoolSize')).toBe(
      String(DEFAULT_MAX_POOL_SIZE),
    );
    expect(url.searchParams.get('minPoolSize')).toBe(
      String(DEFAULT_MIN_POOL_SIZE),
    );
  });

  // Quem escreveu o valor na URL sabe o que quer; o padrão não passa por cima.
  it('não sobrescreve o que já está na URL', () => {
    const url = new URL(
      withPoolSize('mongodb://localhost:27017/opus?maxPoolSize=50'),
    );

    expect(url.searchParams.get('maxPoolSize')).toBe('50');
    expect(url.searchParams.get('minPoolSize')).toBe(
      String(DEFAULT_MIN_POOL_SIZE),
    );
  });

  it('preserva o resto da URL', () => {
    const resultado = withPoolSize(
      'mongodb+srv://quem:senha@cluster.mongodb.net/opus?retryWrites=true',
    );

    expect(resultado).toContain('mongodb+srv://quem:senha@cluster.mongodb.net');
    expect(resultado).toContain('retryWrites=true');
    expect(resultado).toContain('maxPoolSize=');
  });

  it('respeita os valores informados', () => {
    const url = new URL(withPoolSize('mongodb://localhost:27017/opus', 25, 5));

    expect(url.searchParams.get('maxPoolSize')).toBe('25');
    expect(url.searchParams.get('minPoolSize')).toBe('5');
  });

  // Falhar aqui por URL malformada seria trocar um erro claro no boot por um
  // erro obscuro na conexão.
  it('devolve a URL intocada quando não dá para analisá-la', () => {
    expect(withPoolSize('isto-não-é-uma-url')).toBe('isto-não-é-uma-url');
    expect(describePool('isto-não-é-uma-url')).toContain('não foi possível');
  });
});
