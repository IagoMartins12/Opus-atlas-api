import { createHash } from 'crypto';

/**
 * Envelope de todo job da plataforma (**RN-3**).
 *
 * Fila reentrega por definição: se o worker morrer entre o `SMTP OK` e a
 * gravação do resultado, ninguém marcou o job como concluído e o BullMQ o
 * devolve para outro worker. Não é falha de configuração — é o contrato de
 * qualquer fila com garantia de entrega.
 *
 * A consequência prática é que **cada job carrega a chave que torna a
 * reentrega inofensiva**. A chave vira o `jobId` no BullMQ, o que resolve
 * metade do problema (pedir duas vezes a mesma coisa enfileira uma só). A
 * outra metade é do processor, e nenhuma chave resolve por ele: ele precisa
 * ser reentrante, porque a reentrega acontece *depois* de o job já ter
 * começado a produzir efeito.
 */
export interface JobEnvelope<TPayload> {
  /** A mesma chave sempre descreve o mesmo trabalho. */
  idempotencyKey: string;
  /** Id do administrador que pediu, ou `null` para disparo automático. */
  requestedBy: string | null;
  /** ISO 8601. Serve à trilha, não ao agendamento. */
  requestedAt: string;
  payload: TPayload;
}

/** Limite do `jobId` legível antes de cair para o resumo em hash. */
const MAX_READABLE_LENGTH = 120;

const SAFE_SEGMENT = /[^a-zA-Z0-9._-]+/g;

/** Separador de bytes nulos: `['ab','c']` e `['a','bc']` não podem colidir. */
const HASH_SEPARATOR = '\u0000';

/**
 * Monta a chave de idempotência de um job.
 *
 * A chave é **legível sempre que couber**: `newsletter.plan.68f3...` diz na
 * hora qual campanha está na fila, e é isso que se lê às três da manhã quando
 * a campanha não saiu. Só quando as partes passam de 120 caracteres a chave
 * vira um resumo — um `jobId` gigante é chave gigante no Redis, e o BullMQ
 * monta várias por job.
 */
export function buildIdempotencyKey(
  scope: string,
  ...parts: (string | number | null | undefined)[]
): string {
  const normalized = parts.map((part) =>
    String(part ?? '').replace(SAFE_SEGMENT, '-'),
  );

  const readable = [scope, ...normalized].filter(Boolean).join('.');

  if (readable.length <= MAX_READABLE_LENGTH) {
    return readable;
  }

  const digest = createHash('sha256')
    .update(parts.map((part) => String(part ?? '')).join(HASH_SEPARATOR))
    .digest('hex')
    .slice(0, 32);

  return `${scope}.${digest}`;
}

/** Monta o envelope. Existe para que nenhum produtor esqueça um campo. */
export function envelope<TPayload>(input: {
  idempotencyKey: string;
  payload: TPayload;
  requestedBy?: string | null;
}): JobEnvelope<TPayload> {
  return {
    idempotencyKey: input.idempotencyKey,
    requestedBy: input.requestedBy ?? null,
    requestedAt: new Date().toISOString(),
    payload: input.payload,
  };
}
