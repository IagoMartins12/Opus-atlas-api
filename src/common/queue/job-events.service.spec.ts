import { ConfigService } from '@nestjs/config';
import { JobEventsService, JobUpdate } from './job-events.service';
import { QUEUE_PREFIX } from './queue.constants';

interface FakeEvents {
  name: string;
  options: { prefix?: string };
  handlers: Map<string, (payload: unknown) => void>;
  close: jest.Mock;
}

const mockInstances: FakeEvents[] = [];

jest.mock('bullmq', () => ({
  QueueEvents: jest
    .fn()
    .mockImplementation((name: string, options: { prefix?: string }) => {
      const instance: FakeEvents = {
        name,
        options,
        handlers: new Map(),
        close: jest.fn().mockResolvedValue(undefined),
      };

      const self = {
        ...instance,
        on(event: string, handler: (payload: unknown) => void) {
          instance.handlers.set(event, handler);
          return self;
        },
      };

      mockInstances.push(instance);
      return self;
    }),
}));

const fire = (queue: string, event: string, payload: unknown) => {
  const instance = mockInstances.find((candidate) => candidate.name === queue);
  instance?.handlers.get(event)?.(payload);
};

describe('JobEventsService', () => {
  let service: JobEventsService;
  let received: JobUpdate[];

  beforeEach(() => {
    mockInstances.length = 0;
    received = [];

    const config = {
      get: jest.fn().mockReturnValue('redis://localhost:6379'),
    } as unknown as ConfigService;

    service = new JobEventsService(config);
    service.updates$.subscribe((update) => received.push(update));
  });

  // Se o prefixo do gateway divergir do que o `BullModule` usa, nada quebra:
  // o gateway simplesmente nunca recebe evento, e a barra fica parada em zero
  // sem erro em lugar nenhum.
  it('escuta com o mesmo prefixo das filas', () => {
    service.watch('scraper');

    expect(mockInstances[0].options.prefix).toBe(QUEUE_PREFIX);
  });

  describe('conexões sob demanda', () => {
    // Cada `QueueEvents` mantém uma conexão Redis bloqueada, e são quatro
    // filas: deixá-las abertas custaria quatro conexões por réplica da API
    // para um painel que passa quase todo o dia fechado.
    it('não abre nada enquanto ninguém olha', () => {
      expect(mockInstances).toHaveLength(0);
      expect(service.openQueues).toEqual([]);
    });

    it('abre uma conexão só, por mais gente que esteja olhando', () => {
      service.watch('scraper');
      service.watch('scraper');

      expect(mockInstances).toHaveLength(1);
    });

    it('fecha quando o último para de olhar', () => {
      service.watch('scraper');
      service.watch('scraper');

      service.release('scraper');
      expect(mockInstances[0].close).not.toHaveBeenCalled();

      service.release('scraper');
      expect(mockInstances[0].close).toHaveBeenCalled();
      expect(service.openQueues).toEqual([]);
    });

    it('release a mais não quebra nem fecha duas vezes', () => {
      service.watch('scraper');
      service.release('scraper');
      service.release('scraper');

      expect(mockInstances[0].close).toHaveBeenCalledTimes(1);
    });

    it('cada fila tem a sua conexão', () => {
      service.watch('scraper');
      service.watch('newsletter');

      expect(service.openQueues).toEqual(['scraper', 'newsletter']);
    });
  });

  describe('eventos', () => {
    beforeEach(() => service.watch('scraper'));

    it('repassa o progresso com a frase', () => {
      fire('scraper', 'progress', {
        jobId: 'scraper.osesp',
        data: { percent: 80, message: 'Importando...' },
      });

      expect(received[0]).toMatchObject({
        queue: 'scraper',
        jobId: 'scraper.osesp',
        state: 'progress',
        progress: { percent: 80, message: 'Importando...' },
      });
    });

    it('entende o progresso gravado pela versão anterior', () => {
      fire('scraper', 'progress', { jobId: 'j1', data: 42 });

      expect(received[0].progress).toEqual({ percent: 42, message: null });
    });

    it('avisa quando o job começa', () => {
      fire('scraper', 'active', { jobId: 'j1' });

      expect(received[0].state).toBe('active');
    });

    // O resultado não viaja pelo socket: ele já tem formato definido em
    // `GET /admin/jobs/:queue/:jobId`, e serializá-lo num segundo lugar cria
    // duas versões da mesma resposta que divergem na primeira mudança.
    it('avisa que terminou, sem carregar o resultado', () => {
      fire('scraper', 'completed', { jobId: 'j1', returnvalue: '{"a":1}' });

      expect(received[0].state).toBe('completed');
      expect(received[0]).not.toHaveProperty('result');
    });

    it('a falha carrega o motivo', () => {
      fire('scraper', 'failed', { jobId: 'j1', failedReason: 'DNS' });

      expect(received[0]).toMatchObject({
        state: 'failed',
        failedReason: 'DNS',
      });
    });

    // Sem tratador, `error` num EventEmitter do Node é exceção não capturada
    // — um Redis fora do ar derrubaria a API inteira.
    it('erro do Redis não é exceção não capturada', () => {
      expect(() =>
        fire('scraper', 'error', new Error('conexão perdida')),
      ).not.toThrow();
    });
  });

  it('encerrar o módulo fecha tudo que estava aberto', async () => {
    service.watch('scraper');
    service.watch('newsletter');

    await service.onModuleDestroy();

    expect(
      mockInstances.every((instance) => instance.close.mock.calls.length),
    ).toBe(true);
    expect(service.openQueues).toEqual([]);
  });
});
