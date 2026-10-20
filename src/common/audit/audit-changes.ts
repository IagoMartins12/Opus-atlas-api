/**
 * O que uma ação administrativa mudou, em forma legível.
 *
 * Até 29/09/2026 a trilha guardava **quem**, **qual ação** e **em qual id** —
 * mas não **o quê**. "Iago fez `work.update` em 64f…" não responde à pergunta
 * de uma investigação ("quem mudou o compositor desta obra, e de quê para
 * quê?"). Aqui ficam as funções puras que transformam o corpo da requisição e
 * as duas fotos do registro (antes e depois) numa lista curta de mudanças.
 *
 * Três regras, todas pela mesma razão — a trilha existe para ser lida por
 * humanos e é guardada por muito tempo:
 *
 * - **nada sensível entra**: senha, token, hash, documento, cartão;
 * - **nada grande entra**: texto longo é cortado, lista vira contagem;
 * - **só o que mudou**: um PATCH que reenvia 20 campos iguais e troca um
 *   registra um.
 */

/** Nomes de campo que nunca vão para a trilha, em nenhum formato. */
const SENSITIVE =
  /password|senha|secret|token|hash|apikey|api_key|credential|authorization|cvv|cvc|card|cartao|document|cpf|cnpj/i;

/** Acima disso, o texto é cortado — o suficiente para reconhecer. */
const MAX_TEXT = 160;
/** Campos por entrada: um corpo enorme não vira uma linha enorme. */
const MAX_FIELDS = 30;
/** Profundidade de objeto aninhado que ainda se mostra. */
const MAX_DEPTH = 2;

export interface AuditChange {
  campo: string;
  antes: unknown;
  depois: unknown;
}

export const isSensitiveField = (name: string): boolean => SENSITIVE.test(name);

/**
 * Reduz um valor ao que cabe numa linha de auditoria.
 *
 * Datas viram ISO, texto longo é cortado com a contagem do que sobrou, lista
 * longa vira "N itens" e objeto aninhado desce no máximo dois níveis.
 */
export function compactValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();

  if (typeof value === 'string') {
    return value.length > MAX_TEXT
      ? `${value.slice(0, MAX_TEXT)}… (+${value.length - MAX_TEXT} caracteres)`
      : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    if (value.length > 10) return `${value.length} itens`;
    return depth >= MAX_DEPTH
      ? `${value.length} itens`
      : value.map((item) => compactValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    if (depth >= MAX_DEPTH) return '{…}';
    return sanitizeBody(value as Record<string, unknown>, depth + 1);
  }

  return String(value);
}

/**
 * O corpo da requisição sem nada sensível e sem nada grande.
 *
 * Usado quando não há registro para fotografar (criação, ação sobre algo que
 * não é um model): o que foi pedido é a melhor descrição do que aconteceu.
 */
export function sanitizeBody(
  body: unknown,
  depth = 0,
): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  const out: Record<string, unknown> = {};
  let count = 0;

  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (isSensitiveField(key) || value === undefined) continue;
    if (count >= MAX_FIELDS) {
      out['…'] = `mais ${Object.keys(body).length - MAX_FIELDS} campos`;
      break;
    }
    out[key] = compactValue(value, depth);
    count += 1;
  }

  return Object.keys(out).length > 0 ? out : null;
}

/** Igualdade para valores de banco: datas, listas e objetos por conteúdo. */
function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    const ta = a instanceof Date ? a.getTime() : a;
    const tb = b instanceof Date ? b.getTime() : b;
    return ta === tb;
  }
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
  return (a ?? null) === (b ?? null);
}

/**
 * As mudanças entre duas fotos do mesmo registro.
 *
 * `antes` nulo é criação; `depois` nulo é remoção. Nos dois casos a lista
 * traz os campos do lado que existe, para o registro dizer o que nasceu ou o
 * que se perdeu.
 */
export function diffSnapshots(
  antes: Record<string, unknown> | null,
  depois: Record<string, unknown> | null,
  ignorar: readonly string[] = [],
): AuditChange[] {
  if (!antes && !depois) return [];

  const campos = new Set([
    ...Object.keys(antes ?? {}),
    ...Object.keys(depois ?? {}),
  ]);

  const mudancas: AuditChange[] = [];

  for (const campo of campos) {
    if (
      campo === 'id' ||
      campo === 'updatedAt' ||
      ignorar.includes(campo) ||
      isSensitiveField(campo)
    ) {
      continue;
    }

    const a = antes?.[campo];
    const d = depois?.[campo];

    if (antes && depois && same(a, d)) continue;

    mudancas.push({
      campo,
      antes: antes ? compactValue(a) : null,
      depois: depois ? compactValue(d) : null,
    });

    if (mudancas.length >= MAX_FIELDS) break;
  }

  return mudancas;
}

/** O nome legível de um registro, a partir dos campos de rótulo do tipo. */
export function labelOf(
  registro: Record<string, unknown> | null,
  campos: readonly string[],
): string | null {
  if (!registro) return null;

  const partes = campos
    .map((campo) => registro[campo])
    .filter(
      (valor): valor is string | number =>
        (typeof valor === 'string' && valor.trim().length > 0) ||
        typeof valor === 'number',
    )
    .map(String);

  if (partes.length === 0) return null;

  // Nome e sobrenome se juntam; o resto é alternativa ("nome, senão e-mail").
  const [primeiro, segundo] = campos;
  if (primeiro === 'firstName' && segundo === 'lastName') {
    const nome = [registro.firstName, registro.lastName]
      .filter((v) => typeof v === 'string' && v.trim())
      .join(' ');
    if (nome) return nome;
  }

  const texto = partes[0];
  return texto.length > 120 ? `${texto.slice(0, 120)}…` : texto;
}
