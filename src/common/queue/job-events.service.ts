import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueEvents } from 'bullmq';
import { Observable, Subject } from 'rxjs';
import { JobProgress, readProgress } from './job-progress';
import { QUEUE_PREFIX, QueueName } from './queue.constants';
import { parseRedisUrl } from './redis-connection';

/** Estados que o acompanhamento em tempo real reporta. */
export type JobUpdateState = 'active' | 'progress' | 'completed' | 'failed';

export interface JobUpdate {
  queue: QueueName;
  jobId: string;
  state: JobUpdateState;
  /** Só vem em `progress`. */
  progress: JobProgress | null;
  /** Só vem em `failed`. */
  failedReason: string | null;
  /** ISO 8601, do relógio de quem recebeu o evento. */
  at: string;
}

/**
 * Escuta o que acontece na fila, para quem não é o worker.
 *
 * **O evento nasce em outro processo.** Quem move o progresso é o worker
 * (`QUEUE_ROLE=worker`), e quem tem o navegador conectado é a API — dois
 * contêineres distintos, que é exatamente o ponto da separação. Um
 * `EventEmitter` em memória não atravessa essa fronteira: funcionaria só no
 * modo `all`, onde tudo roda junto, e ficaria mudo em produção.
 *
 * O `QueueEvents` do BullMQ resolve isso porque lê de um **stream no Redis**,
 * não da memória de ninguém. E resolve de quebra a segunda metade do problema:
 * com várias réplicas da API, todas leem o mesmo stream, então o administrador
 * recebe o progresso independentemente de qual réplica atendeu o socket. É por
 * isso que aqui não entra adaptador de Redis para o socket.io nem sessão
 * grudada no balanceador — não há mensagem para uma réplica repassar à outra.
 *
 * **As conexões são abertas sob demanda.** Cada `QueueEvents` mantém uma
 * conexão Redis bloqueada, e são quatro filas: deixá-las abertas o tempo todo
 * custaria quatro conexões por réplica da API para um painel que passa quase
 * todo o dia fechado. Aqui elas sobem quando alguém começa a olhar e caem
 * quando o último para.
 */
@Injectable()
export class JobEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(JobEventsService.name);
  private readonly subject = new Subject<JobUpdate>();
  private readonly open = new Map<
    QueueName,
    { events: QueueEvents; watchers: number }
  >();

  constructor(private readonly config: ConfigService) {}

  /** Tudo que chega das filas atualmente observadas. */
  get updates$(): Observable<JobUpdate> {
    return this.subject.asObservable();
  }

  /** Passa a observar uma fila. Cada chamada exige um `release` depois. */
  watch(queue: QueueName): void {
    const entry = this.open.get(queue);

    if (entry) {
      entry.watchers += 1;
      return;
    }

    this.open.set(queue, { events: this.connect(queue), watchers: 1 });
    this.logger.log(`Escutando eventos da fila ${queue}`);
  }

  /** Deixa de observar. Fecha a conexão quando não sobrou ninguém olhando. */
  release(queue: QueueName): void {
    const entry = this.open.get(queue);

    if (!entry) {
      return;
    }

    entry.watchers -= 1;

    if (entry.watchers > 0) {
      return;
    }

    this.open.delete(queue);
    void entry.events.close().catch((error: unknown) => {
      this.logger.warn(
        `Falha ao fechar a escuta da fila ${queue}: ${String(error)}`,
      );
    });
    this.logger.log(`Sem ninguém olhando a fila ${queue}, escuta encerrada`);
  }

  /** Quantas filas estão sendo escutadas agora. Serve à observabilidade. */
  get openQueues(): QueueName[] {
    return [...this.open.keys()];
  }

  async onModuleDestroy(): Promise<void> {
    const entries = [...this.open.values()];
    this.open.clear();
    this.subject.complete();

    await Promise.all(
      entries.map((entry) => entry.events.close().catch(() => undefined)),
    );
  }

  private connect(queue: QueueName): QueueEvents {
    const events = new QueueEvents(queue, {
      connection: parseRedisUrl(
        this.config.get<string>('redis.url', 'redis://localhost:6379'),
      ),
      prefix: QUEUE_PREFIX,
    });

    events.on('active', ({ jobId }) => this.push(queue, jobId, 'active', {}));

    events.on('progress', ({ jobId, data }) =>
      this.push(queue, jobId, 'progress', { progress: readProgress(data) }),
    );

    // O resultado do job **não** viaja por aqui, de propósito: ele já tem um
    // formato definido em `GET /admin/jobs/:queue/:jobId`, e serializá-lo num
    // segundo lugar cria duas versões da mesma resposta que divergem na
    // primeira mudança. O socket avisa que terminou; quem quiser o resultado
    // busca onde ele mora.
    events.on('completed', ({ jobId }) =>
      this.push(queue, jobId, 'completed', {}),
    );

    events.on('failed', ({ jobId, failedReason }) =>
      this.push(queue, jobId, 'failed', { failedReason: failedReason ?? null }),
    );

    // Sem este tratador, um Redis fora do ar vira `error` sem ouvinte num
    // `EventEmitter` — que no Node é exceção não capturada, e derruba a API.
    events.on('error', (error: Error) => {
      this.logger.warn(
        `Escuta da fila ${queue} reclamou: ${error.message}. ` +
          'O BullMQ reconecta sozinho; o progresso volta quando o Redis voltar.',
      );
    });

    return events;
  }

  private push(
    queue: QueueName,
    jobId: string,
    state: JobUpdateState,
    extra: { progress?: JobProgress | null; failedReason?: string | null },
  ): void {
    this.subject.next({
      queue,
      jobId,
      state,
      progress: extra.progress ?? null,
      failedReason: extra.failedReason ?? null,
      at: new Date().toISOString(),
    });
  }
}
