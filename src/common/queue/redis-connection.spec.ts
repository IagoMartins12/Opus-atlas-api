import { parseRedisUrl } from './redis-connection';

type Options = Record<string, unknown>;

describe('parseRedisUrl', () => {
  it('abre host e porta', () => {
    const options = parseRedisUrl('redis://cache.interno:6380') as Options;

    expect(options.host).toBe('cache.interno');
    expect(options.port).toBe(6380);
  });

  it('assume a porta padrão quando ela não vem', () => {
    expect((parseRedisUrl('redis://localhost') as Options).port).toBe(6379);
  });

  it('lê credenciais, decodificando o que veio escapado', () => {
    const options = parseRedisUrl(
      'redis://user:se%40nha@localhost:6379',
    ) as Options;

    expect(options.username).toBe('user');
    expect(options.password).toBe('se@nha');
  });

  it('lê o índice do banco', () => {
    expect((parseRedisUrl('redis://localhost:6379/3') as Options).db).toBe(3);
  });

  it('não inventa índice quando o caminho é só a barra', () => {
    expect(
      parseRedisUrl('redis://localhost:6379/') as Options,
    ).not.toHaveProperty('db');
  });

  it('liga TLS em rediss', () => {
    expect((parseRedisUrl('rediss://localhost:6379') as Options).tls).toEqual(
      {},
    );
  });

  // Sem isto o worker derruba a própria conexão enquanto espera job: a espera
  // bloqueante é longa por natureza e o ioredis a lê como comando travado.
  it('exige as opções que o BullMQ não dispensa', () => {
    const options = parseRedisUrl('redis://localhost:6379') as Options;

    expect(options.maxRetriesPerRequest).toBeNull();
    expect(options.enableReadyCheck).toBe(false);
  });

  it('recusa URL malformada', () => {
    expect(() => parseRedisUrl('não é uma url')).toThrow(/REDIS_URL inválida/);
  });

  it('recusa protocolo que não é redis', () => {
    expect(() => parseRedisUrl('http://localhost:6379')).toThrow(
      /Protocolo não suportado/,
    );
  });
});
