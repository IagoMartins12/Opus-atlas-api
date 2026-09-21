import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { authCookieNames } from '../../auth/auth-cookie.service';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { JobEventsService } from './job-events.service';
import { JobStatusService } from './job-status.service';
import {
  MAX_WATCHES_PER_SOCKET,
  roomOf,
  ROLE_ADMIN,
  watchRefusal,
} from './job-watch.policy';
import { isQueueName, QueueName } from './queue.constants';

interface SocketState {
  user: AccessTokenPayload;
  /** `fila:jobId` de tudo que esta conexão observa. */
  watching: Set<string>;
}

interface WatchMessage {
  queue?: unknown;
  jobId?: unknown;
}

/**
 * Progresso de job em tempo real.
 *
 * **Substitui o pedaço que o polling não cobre.** `GET /admin/jobs/:queue/:jobId`
 * continua existindo e continua sendo a fonte do resultado; o que ele não faz
 * é avisar. Numa varredura de dez minutos, o painel tinha de escolher entre
 * perguntar de dois em dois segundos — quinhentas requisições autenticadas por
 * varredura, quase todas devolvendo o mesmo número — ou perguntar de raro em
 * raro e mostrar uma barra que anda aos saltos.
 *
 * **Por que WebSocket e não SSE.** O `EventSource` do navegador não deixa
 * definir cabeçalho, e a autenticação daqui é `Authorization: Bearer` — o token
 * teria de ir na URL, onde ele é gravado em log de acesso, em log de proxy e no
 * histórico. O socket.io manda credencial no corpo do handshake, fora da URL.
 * Some-se que o `compression()` global do Express bufferiza resposta em fluxo,
 * então SSE exigiria excetuar a rota da compressão; a conexão WebSocket é um
 * upgrade e não passa por essa camada.
 *
 * **Sem adaptador de Redis e sem sessão grudada.** Não há mensagem indo de uma
 * réplica da API para outra: o evento vem do stream do Redis pelo
 * `JobEventsService`, e toda réplica lê o mesmo stream.
 */
@WebSocketGateway({
  namespace: 'jobs',
  // O CORS real é montado em `JobsIoAdapter`, com a allowlist do
  // `ConfigService`. Aqui não dá: opção de decorator é avaliada na importação
  // do módulo, antes de a configuração existir.
})
export class JobsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(JobsGateway.name);
  private readonly states = new WeakMap<Socket, SocketState>();

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly events: JobEventsService,
    private readonly status: JobStatusService,
  ) {}

  onModuleInit(): void {
    this.events.updates$.subscribe((update) => {
      this.server
        ?.to(roomOf(update.queue, update.jobId))
        .emit('job.update', update);
    });
  }

  /**
   * Autentica na conexão, não na primeira mensagem.
   *
   * Um socket aberto é recurso alocado: quem não provou quem é não deve
   * conseguir manter conexão de pé esperando para tentar de novo.
   */
  handleConnection(client: Socket): void {
    const origin = client.handshake.headers.origin;

    // Origem só é conferida quando existe. Cliente que não é navegador não
    // manda `Origin`, e não é ele o alvo aqui: a checagem existe contra página
    // de terceiro abrindo socket com o navegador da vítima. Ainda assim é
    // defesa em profundidade — a credencial daqui é um token explícito, que
    // página de outra origem não tem como ler.
    if (origin && !this.allowedOrigins().includes(origin)) {
      return this.refuse(client, `Origem não autorizada: ${origin}`);
    }

    const user = this.authenticate(client);

    if (!user) {
      return this.refuse(client, 'Token ausente, inválido ou expirado');
    }

    if (user.role < ROLE_ADMIN) {
      return this.refuse(client, 'Você não tem permissão para acompanhar jobs');
    }

    this.states.set(client, { user, watching: new Set() });
  }

  handleDisconnect(client: Socket): void {
    const state = this.states.get(client);

    if (!state) {
      return;
    }

    // Cada `watch` abriu uma escuta de fila; sem devolver todas elas na
    // desconexão, as conexões Redis do `JobEventsService` nunca fecham e o
    // "sob demanda" vira "para sempre".
    for (const room of state.watching) {
      const queue = room.slice(0, room.indexOf(':'));

      if (isQueueName(queue)) {
        this.events.release(queue);
      }
    }

    state.watching.clear();
    this.states.delete(client);
  }

  @SubscribeMessage('watch')
  async watch(client: Socket, message: WatchMessage) {
    const state = this.states.get(client);

    if (!state) {
      return { ok: false, error: 'Conexão não autenticada' };
    }

    const queue = message?.queue;
    const jobId = message?.jobId;

    if (typeof queue !== 'string' || !isQueueName(queue)) {
      return { ok: false, error: `Fila desconhecida: "${String(queue)}"` };
    }

    if (typeof jobId !== 'string' || !jobId.trim()) {
      return { ok: false, error: 'Informe o `jobId`' };
    }

    const room = roomOf(queue, jobId);

    if (state.watching.has(room)) {
      return { ok: true, room, alreadyWatching: true };
    }

    // Sem teto, uma conexão só entra em milhares de salas e passa a receber
    // o tráfego de toda a fila.
    if (state.watching.size >= MAX_WATCHES_PER_SOCKET) {
      return {
        ok: false,
        error: `Uma conexão acompanha no máximo ${MAX_WATCHES_PER_SOCKET} jobs.`,
      };
    }

    const view = await this.status.describe(queue as QueueName, jobId);
    const refusal = watchRefusal(state.user, view);

    if (refusal) {
      return { ok: false, error: refusal };
    }

    this.events.watch(queue);
    state.watching.add(room);
    await client.join(room);

    // **O estado atual vai junto da confirmação.** Sem isso, quem se conecta
    // depois de o job já ter terminado fica esperando um evento que não vem
    // mais — a barra congela em zero para um trabalho concluído. É também o
    // caso do recarregamento de página no meio de uma varredura.
    return { ok: true, room, job: view };
  }

  @SubscribeMessage('unwatch')
  async unwatch(client: Socket, message: WatchMessage) {
    const state = this.states.get(client);
    const queue = message?.queue;
    const jobId = message?.jobId;

    if (!state || typeof queue !== 'string' || typeof jobId !== 'string') {
      return { ok: false };
    }

    const room = roomOf(queue, jobId);

    if (!state.watching.delete(room)) {
      return { ok: false };
    }

    await client.leave(room);

    if (isQueueName(queue)) {
      this.events.release(queue);
    }

    return { ok: true };
  }

  // -------------------------------------------------------------------

  private authenticate(client: Socket): AccessTokenPayload | null {
    const raw =
      readToken(client.handshake.auth?.token) ??
      readBearer(client.handshake.headers.authorization) ??
      readCookie(client.handshake.headers.cookie, authCookieNames().access);

    if (!raw) {
      return null;
    }

    try {
      const payload = this.jwt.verify<AccessTokenPayload>(raw, {
        secret: this.config.get<string>('auth.accessSecret'),
      });

      // O token de refresh é assinado com outro segredo e já não passaria da
      // verificação. A conferência de `type` é a segunda tranca: ela sobrevive
      // a alguém, um dia, unificar os segredos por engano.
      return payload?.type === 'access' ? payload : null;
    } catch {
      return null;
    }
  }

  private allowedOrigins(): string[] {
    return this.config.get<string[]>('cors.allowedOrigins', []);
  }

  private refuse(client: Socket, reason: string): void {
    this.logger.warn(`Conexão de progresso recusada: ${reason}`);
    client.emit('job.refused', { error: reason });
    client.disconnect(true);
  }
}

function readToken(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readBearer(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * O navegador manda o cookie da sessão no handshake (mesmo site, com
 * `withCredentials`). A origem já foi conferida contra a allowlist antes daqui,
 * então um site de terceiros não aproveita o cookie.
 */
function readCookie(header: unknown, name: string): string | null {
  if (typeof header !== 'string') {
    return null;
  }

  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');

    if (key === name) {
      const value = rest.join('=');

      try {
        return decodeURIComponent(value) || null;
      } catch {
        return value || null;
      }
    }
  }

  return null;
}
