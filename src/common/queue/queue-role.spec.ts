import { resolveQueueRole, runsWorkers, servesHttp } from './queue-role';

describe('resolveQueueRole', () => {
  it('assume `all` quando não há variável', () => {
    expect(resolveQueueRole({})).toBe('all');
  });

  it('aceita os três papéis', () => {
    expect(resolveQueueRole({ QUEUE_ROLE: 'api' })).toBe('api');
    expect(resolveQueueRole({ QUEUE_ROLE: 'worker' })).toBe('worker');
    expect(resolveQueueRole({ QUEUE_ROLE: 'all' })).toBe('all');
  });

  it('normaliza espaço e caixa', () => {
    expect(resolveQueueRole({ QUEUE_ROLE: '  WORKER ' })).toBe('worker');
  });

  // Um typo tratado como padrão daria um cluster onde ninguém consome fila:
  // as rotas seguem respondendo 202 e nada nunca acontece.
  it('derruba o boot em valor desconhecido', () => {
    expect(() => resolveQueueRole({ QUEUE_ROLE: 'workr' })).toThrow(
      /QUEUE_ROLE inválido/,
    );
  });
});

describe('divisão de papéis', () => {
  it('`api` enfileira e não consome', () => {
    expect(servesHttp({ QUEUE_ROLE: 'api' })).toBe(true);
    expect(runsWorkers({ QUEUE_ROLE: 'api' })).toBe(false);
  });

  it('`worker` consome', () => {
    expect(runsWorkers({ QUEUE_ROLE: 'worker' })).toBe(true);
  });

  it('`all` faz as duas coisas', () => {
    expect(servesHttp({ QUEUE_ROLE: 'all' })).toBe(true);
    expect(runsWorkers({ QUEUE_ROLE: 'all' })).toBe(true);
  });
});
