/**
 * Camada L1 do cache: um mapa no processo, na frente do Redis.
 *
 * **Por que existe.** Depois de corrigir as consultas, o custo dominante de uma
 * leitura pública deixou de ser o banco e passou a ser a ida ao Redis — ~1 ms
 * de rede por requisição, multiplicado por toda visita anônima. As respostas do
 * catálogo são idênticas para todo mundo e mudam raramente, então manter as
 * mais quentes no processo por alguns segundos tira essa ida do caminho.
 *
 * **O preço, explicitado.** Cada réplica tem o seu L1. A invalidação por
 * namespace limpa o Redis e o L1 *da réplica que a executou*; as outras servem
 * o valor antigo até o TTL curto expirar. Por isso o TTL daqui é de segundos,
 * não de minutos: é o teto da divergência entre réplicas. Dado por usuário
 * nunca entra aqui — só leitura pública.
 *
 * Evicção por ordem de inserção (o `Map` do JS preserva essa ordem), com
 * renovação no acesso: LRU simples, sem dependência nova.
 */
export interface HotCacheOptions {
  /** Máximo de entradas antes de evictar a mais antiga. */
  maxEntries: number;
}

interface HotEntry<T> {
  value: T;
  expiresAt: number;
}

export class HotCache {
  private readonly entries = new Map<string, HotEntry<unknown>>();

  constructor(private readonly options: HotCacheOptions) {}

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);

    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    // Acesso renova a posição: o mais usado é o último a sair.
    this.entries.delete(key);
    this.entries.set(key, entry);

    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    if (ttlMs <= 0) {
      return;
    }

    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });

    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  /** Remove tudo que começa com o prefixo — usado na invalidação por domínio. */
  deleteByPrefix(prefix: string): number {
    let removed = 0;

    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
        removed += 1;
      }
    }

    return removed;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
