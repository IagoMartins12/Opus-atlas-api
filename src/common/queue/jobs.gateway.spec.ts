import { ConfigService } from '@nestjs/config';
// `@nestjs/jwt@12` é publicado como ESM puro e quebra o parser CJS do ts-jest
// quando carregado de verdade — mockamos o módulo inteiro para nunca importá-lo.
jest.mock('@nestjs/jwt', () => ({
  JwtService: class JwtService {},
}));
import { JwtService } from '@nestjs/jwt';
import { Subject } from 'rxjs';
import { Server, Socket } from 'socket.io';
import { JobEventsService, JobUpdate } from './job-events.service';
import { JobStatusService } from './job-status.service';
import { JobsGateway } from './jobs.gateway';
import { MAX_WATCHES_PER_SOCKET } from './job-watch.policy';

const ORIGIN = 'https://app.opusatlas.com';

const superAdmin = {
  sub: 'super-1',
  email: 's@x.com',
  role: 2,
  isTeacher: false,
  isStudent: false,
  type: 'access' as const,
};

const professor = { ...superAdmin, sub: 'prof-1', role: 1 };

interface FakeSocket {
  handshake: {
    headers: Record<string, string | undefined>;
    auth: Record<string, unknown>;
  };
  join: jest.Mock;
  leave: jest.Mock;
  emit: jest.Mock;
  disconnect: jest.Mock;
}

const socketOf = (
  overrides: Partial<FakeSocket['handshake']> = {},
): FakeSocket => ({
  handshake: {
    headers: { origin: ORIGIN },
    auth: { token: 'token-valido' },
    ...overrides,
  },
  join: jest.fn().mockResolvedValue(undefined),
  leave: jest.fn().mockResolvedValue(undefined),
  emit: jest.fn(),
  disconnect: jest.fn(),
});

describe('JobsGateway', () => {
  let gateway: JobsGateway;
  let jwt: { verify: jest.Mock };
  let events: {
    watch: jest.Mock;
    release: jest.Mock;
    updates$: Subject<JobUpdate>;
  };
  let status: { describe: jest.Mock };
  let emitToRoom: jest.Mock;
  let to: jest.Mock;

  const asSocket = (fake: FakeSocket) => fake as unknown as Socket;

  beforeEach(() => {
    jwt = { verify: jest.fn().mockReturnValue(superAdmin) };

    const config = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === 'cors.allowedOrigins' ? [ORIGIN] : (fallback ?? 'segredo'),
      ),
    } as unknown as ConfigService;

    events = {
      watch: jest.fn(),
      release: jest.fn(),
      updates$: new Subject<JobUpdate>(),
    };

    status = {
      describe: jest.fn().mockResolvedValue({
        queue: 'scraper',
        jobId: 'j1',
        state: 'active',
        requestedBy: 'super-1',
        progress: { percent: 30, message: 'Lendo a programação...' },
      }),
    };

    gateway = new JobsGateway(
      jwt as unknown as JwtService,
      config,
      events as unknown as JobEventsService,
      status as unknown as JobStatusService,
    );

    emitToRoom = jest.fn();
    to = jest.fn().mockReturnValue({ emit: emitToRoom });
    gateway.server = { to } as unknown as Server;
    gateway.onModuleInit();
  });

  describe('conexão', () => {
    it('aceita administrador com token válido', () => {
      const socket = socketOf();

      gateway.handleConnection(asSocket(socket));

      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    // Um socket aberto é recurso alocado: quem não provou quem é não deve
    // conseguir manter conexão de pé esperando para tentar de novo.
    it('recusa sem token', () => {
      const socket = socketOf({ auth: {}, headers: { origin: ORIGIN } });

      gateway.handleConnection(asSocket(socket));

      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.emit).toHaveBeenCalledWith(
        'job.refused',
        expect.objectContaining({ error: expect.stringMatching(/Token/) }),
      );
    });

    it('recusa token inválido ou expirado', () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      const socket = socketOf();
      gateway.handleConnection(asSocket(socket));

      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    // Segunda tranca: os segredos já são diferentes, mas a conferência
    // sobrevive a alguém unificá-los um dia por engano.
    it('recusa token de refresh', () => {
      jwt.verify.mockReturnValue({ sub: 'x', type: 'refresh', role: 2 });

      const socket = socketOf();
      gateway.handleConnection(asSocket(socket));

      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('recusa usuário comum', () => {
      jwt.verify.mockReturnValue({ ...superAdmin, role: 0 });

      const socket = socketOf();
      gateway.handleConnection(asSocket(socket));

      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('recusa origem fora da allowlist', () => {
      const socket = socketOf({
        headers: { origin: 'https://site-de-terceiro.com' },
        auth: { token: 'token-valido' },
      });

      gateway.handleConnection(asSocket(socket));

      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    // Cliente que não é navegador não manda `Origin`, e não é ele o alvo da
    // checagem — a credencial daqui é um token explícito.
    it('aceita cliente sem cabeçalho de origem', () => {
      const socket = socketOf({ headers: {}, auth: { token: 'token-valido' } });

      gateway.handleConnection(asSocket(socket));

      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('aceita o token no cabeçalho Authorization', () => {
      const socket = socketOf({
        headers: { origin: ORIGIN, authorization: 'Bearer token-valido' },
        auth: {},
      });

      gateway.handleConnection(asSocket(socket));

      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    // O navegador manda o cookie da sessão no handshake; a origem já foi
    // conferida contra a allowlist antes.
    it('aceita o token do cookie da sessão', () => {
      const socket = socketOf({
        headers: {
          origin: ORIGIN,
          cookie: 'outro=1; opus_access_token=token-valido',
        },
        auth: {},
      });

      gateway.handleConnection(asSocket(socket));

      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('cookie sem o token da sessão não autentica', () => {
      const socket = socketOf({
        headers: { origin: ORIGIN, cookie: 'outro=1' },
        auth: {},
      });

      gateway.handleConnection(asSocket(socket));

      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    // Um JWT nunca tem `%`: o valor cru chega à verificação, que o recusa.
    it('cookie com codificação quebrada vai cru para a verificação', () => {
      const socket = socketOf({
        headers: { origin: ORIGIN, cookie: 'opus_access_token=%E0%A4%A' },
        auth: {},
      });

      gateway.handleConnection(asSocket(socket));

      expect(jwt.verify).toHaveBeenCalledWith('%E0%A4%A', expect.anything());
    });
  });

  describe('watch', () => {
    let socket: FakeSocket;

    beforeEach(() => {
      socket = socketOf();
      gateway.handleConnection(asSocket(socket));
    });

    it('entra na sala do job e passa a escutar a fila', async () => {
      const reply = await gateway.watch(asSocket(socket), {
        queue: 'scraper',
        jobId: 'j1',
      });

      expect(reply).toMatchObject({ ok: true, room: 'scraper:j1' });
      expect(socket.join).toHaveBeenCalledWith('scraper:j1');
      expect(events.watch).toHaveBeenCalledWith('scraper');
    });

    // Sem isto, quem se conecta depois de o job terminar espera um evento que
    // não vem mais: a barra congela em zero para um trabalho concluído. É
    // também o caso de recarregar a página no meio de uma varredura.
    it('a confirmação já traz o estado atual do job', async () => {
      const reply = await gateway.watch(asSocket(socket), {
        queue: 'scraper',
        jobId: 'j1',
      });

      expect(reply).toMatchObject({
        job: { state: 'active', progress: { percent: 30 } },
      });
    });

    it('recusa fila desconhecida', async () => {
      const reply = await gateway.watch(asSocket(socket), {
        queue: 'fila-que-nao-existe',
        jobId: 'j1',
      });

      expect(reply).toMatchObject({ ok: false });
      expect(events.watch).not.toHaveBeenCalled();
    });

    it('recusa jobId ausente', async () => {
      const reply = await gateway.watch(asSocket(socket), {
        queue: 'scraper',
        jobId: '  ',
      });

      expect(reply).toMatchObject({ ok: false });
    });

    it('recusa job inexistente', async () => {
      status.describe.mockResolvedValue(null);

      const reply = await gateway.watch(asSocket(socket), {
        queue: 'scraper',
        jobId: 'sumiu',
      });

      expect(reply).toMatchObject({ ok: false });
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('pedir a mesma sala duas vezes não abre duas escutas', async () => {
      await gateway.watch(asSocket(socket), { queue: 'scraper', jobId: 'j1' });
      const reply = await gateway.watch(asSocket(socket), {
        queue: 'scraper',
        jobId: 'j1',
      });

      expect(reply).toMatchObject({ alreadyWatching: true });
      expect(events.watch).toHaveBeenCalledTimes(1);
    });

    // Sem teto, uma conexão só entra em milhares de salas e passa a receber o
    // tráfego de toda a fila.
    it('respeita o teto de jobs por conexão', async () => {
      for (let index = 0; index < MAX_WATCHES_PER_SOCKET; index += 1) {
        await gateway.watch(asSocket(socket), {
          queue: 'scraper',
          jobId: `j${index}`,
        });
      }

      const reply = await gateway.watch(asSocket(socket), {
        queue: 'scraper',
        jobId: 'excedente',
      });

      expect(reply).toMatchObject({ ok: false });
    });

    it('conexão não autenticada não observa nada', async () => {
      const reply = await gateway.watch(asSocket(socketOf()), {
        queue: 'scraper',
        jobId: 'j1',
      });

      expect(reply).toMatchObject({ ok: false });
    });

    describe('quem pode acompanhar o quê', () => {
      it('administrador acompanha job que não pediu', async () => {
        status.describe.mockResolvedValue({ requestedBy: 'outra-pessoa' });

        const reply = await gateway.watch(asSocket(socket), {
          queue: 'scraper',
          jobId: 'j1',
        });

        expect(reply).toMatchObject({ ok: true });
      });

      /**
       * O socket não pode ser porta mais larga que a rota REST. Com `ADMIN`
       * valendo `role: 1`, todo professor vindo do legado entrava aqui.
       */
      it('professor não acompanha nada', async () => {
        jwt.verify.mockReturnValue(professor);
        const socketProf = socketOf();
        gateway.handleConnection(asSocket(socketProf));
        status.describe.mockResolvedValue({ requestedBy: 'prof-1' });

        const reply = await gateway.watch(asSocket(socketProf), {
          queue: 'scraper',
          jobId: 'j1',
        });

        expect(reply).toMatchObject({ ok: false });
        expect(socketProf.join).not.toHaveBeenCalled();
      });
    });
  });

  describe('unwatch e desconexão', () => {
    let socket: FakeSocket;

    beforeEach(async () => {
      socket = socketOf();
      gateway.handleConnection(asSocket(socket));
      await gateway.watch(asSocket(socket), { queue: 'scraper', jobId: 'j1' });
    });

    it('unwatch devolve a escuta', async () => {
      const reply = await gateway.unwatch(asSocket(socket), {
        queue: 'scraper',
        jobId: 'j1',
      });

      expect(reply).toEqual({ ok: true });
      expect(socket.leave).toHaveBeenCalledWith('scraper:j1');
      expect(events.release).toHaveBeenCalledWith('scraper');
    });

    it('unwatch de sala não observada não devolve escuta alheia', async () => {
      await gateway.unwatch(asSocket(socket), {
        queue: 'scraper',
        jobId: 'nunca-observado',
      });

      expect(events.release).not.toHaveBeenCalled();
    });

    // Sem devolver as escutas na desconexão, as conexões Redis nunca fecham e
    // o "sob demanda" vira "para sempre".
    it('desconectar devolve todas as escutas', async () => {
      await gateway.watch(asSocket(socket), {
        queue: 'newsletter',
        jobId: 'j2',
      });

      gateway.handleDisconnect(asSocket(socket));

      expect(events.release).toHaveBeenCalledWith('scraper');
      expect(events.release).toHaveBeenCalledWith('newsletter');
    });

    it('desconexão de socket nunca autenticado não faz nada', () => {
      gateway.handleDisconnect(asSocket(socketOf()));

      expect(events.release).not.toHaveBeenCalled();
    });
  });

  describe('repasse dos eventos', () => {
    it('manda a atualização só para a sala do job', () => {
      const update: JobUpdate = {
        queue: 'scraper',
        jobId: 'j1',
        state: 'progress',
        progress: { percent: 80, message: 'Importando...' },
        failedReason: null,
        at: new Date().toISOString(),
      };

      events.updates$.next(update);

      expect(to).toHaveBeenCalledWith('scraper:j1');
      expect(emitToRoom).toHaveBeenCalledWith('job.update', update);
    });
  });
});
