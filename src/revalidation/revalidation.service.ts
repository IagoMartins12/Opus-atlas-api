import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import {
  CACHE_INVALIDATED_EVENT,
  CacheInvalidatedEvent,
  CacheNamespaceValue,
} from '../common/cache/cache-keys';
import { errorMessage } from '../common/utils/error.util';

/**
 * Avisos que chegam juntos (uma escrita limpa vários domínios) viram um só.
 *
 * Curto de propósito (24/10): quem gravou espera o aviso chegar ao front
 * antes de receber a resposta (`CacheService` aguarda o evento), para ver o
 * que mandou já na próxima página. Com 2 s em segundo plano, a recarga logo
 * depois da gravação ainda pegava a cópia velha.
 */
export const REVALIDATE_DEBOUNCE_MS = 150;

const REQUEST_TIMEOUT_MS = 5_000;

/** Tag do Next para um namespace: `blog:articles` → `blog-articles`. */
export function tagOf(namespace: CacheNamespaceValue): string {
  return namespace.replace(/:/g, '-');
}

/**
 * Avisa o front quando o dado muda — o substituto do `POST /api/revalidate`.
 *
 * **Por que a rota do legado não foi portada.** Ela chamava `revalidatePath`,
 * que só existe dentro do Next: a API não tem como executá-la. E como estava,
 * fazia mal — aceitava qualquer usuário logado e qualquer caminho, então
 * qualquer conta esvaziava o cache de qualquer página, e o único chamador era
 * um hook que disparava ao voltar de uma aba ociosa, sem que o dado tivesse
 * mudado.
 *
 * **O que existe no lugar.** Toda limpeza de cache da API
 * (`CACHE_INVALIDATED_EVENT`) é o sinal de que o dado de um domínio mudou. Este
 * serviço junta os domínios de 2 em 2 segundos e faz um `POST` para
 * `FRONT_REVALIDATE_URL` com `{ tags }`, assinado por
 * `FRONT_REVALIDATE_SECRET` no cabeçalho `x-revalidate-secret`. O front
 * responde com `revalidateTag` para cada uma — o contrato está no cérebro de
 * backend, em "Revalidação do front".
 *
 * **É melhor esforço, de propósito.** Falha vira log, nunca erro na escrita que
 * a causou; o TTL do cache do front continua sendo a rede de segurança. Sem
 * `FRONT_REVALIDATE_URL`, fica desligado.
 */
@Injectable()
export class RevalidationService implements OnModuleDestroy {
  private readonly logger = new Logger(RevalidationService.name);
  private readonly url?: string;
  private readonly secret?: string;
  private readonly pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  /** O envio do lote em formação: quem pediu espera por ele. */
  private batch: Promise<void> | null = null;

  constructor(config: ConfigService) {
    this.url = config.get<string>('revalidation.url') || undefined;
    this.secret = config.get<string>('revalidation.secret') || undefined;

    if (!this.url) {
      this.logger.log(
        'FRONT_REVALIDATE_URL não configurada — o front não recebe aviso de dado novo (vale o TTL)',
      );
    }
  }

  get enabled(): boolean {
    return !!this.url && !!this.secret;
  }

  /**
   * Junta as tags no lote e devolve a promessa do envio dele — o
   * `CacheService` a espera (com teto) antes de a gravação responder.
   */
  @OnEvent(CACHE_INVALIDATED_EVENT, { promisify: true })
  onCacheInvalidated(event: CacheInvalidatedEvent): Promise<void> {
    if (!this.enabled) return Promise.resolve();

    event.namespaces.forEach((namespace) => this.pending.add(tagOf(namespace)));

    this.batch ??= new Promise<void>((resolve) => {
      this.timer = setTimeout(() => {
        this.batch = null;
        void this.flush().finally(resolve);
      }, REVALIDATE_DEBOUNCE_MS);
    });
    return this.batch;
  }

  /** Envia o que estiver acumulado. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.batch = null;

    if (this.pending.size === 0 || !this.url || !this.secret) return;

    const tags = [...this.pending].sort();
    this.pending.clear();

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-revalidate-secret': this.secret,
        },
        body: JSON.stringify({ tags, source: 'opus-atlas-api' }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.logger.warn(
          `O front recusou a revalidação (${response.status}) de: ${tags.join(', ')}`,
        );
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Revalidação do front falhou (${tags.join(', ')}): ${errorMessage(error)}`,
      );
    }
  }

  /** Ao desligar, manda o que ficou na fila em vez de perder. */
  async onModuleDestroy(): Promise<void> {
    await this.flush();
  }
}
