/**
 * Dimensionamento do pool de conexões do MongoDB (SPEC §10.5 e §11.6).
 *
 * **O problema.** O driver do Mongo abre, por padrão, até 100 conexões por
 * processo. Com N réplicas da API e M do worker, o teto efetivo é
 * `(N + M) × 100` — e um cluster gerenciado costuma cortar bem antes disso.
 * O sintoma não é lentidão: é `connection pool cleared` no meio de um pico,
 * exatamente quando escalar deveria ajudar.
 *
 * **A decisão de pôr isto no código.** O valor poderia viver só na
 * `DATABASE_URL`, mas aí depende de alguém lembrar de escrevê-lo em cada
 * ambiente — e o esquecimento não falha, só aparece sob carga. Aqui o valor é
 * aplicado sempre, com um padrão conservador, e a URL continua mandando quando
 * traz o parâmetro explicitamente.
 */

/** Conexões por processo. 10 × (réplicas de API + worker) cabe em qualquer plano. */
export const DEFAULT_MAX_POOL_SIZE = 10;

/** Conexões mantidas abertas, para o pico não pagar o custo de abrir. */
export const DEFAULT_MIN_POOL_SIZE = 2;

/**
 * Acrescenta o dimensionamento do pool à URL, sem sobrescrever o que já estiver
 * escrito nela.
 *
 * Devolve a URL intocada se ela não for analisável — quem valida a
 * `DATABASE_URL` é o boot (`env.validation.ts`), e não é aqui que a aplicação
 * deve falhar por isso.
 */
export function withPoolSize(
  databaseUrl: string,
  maxPoolSize: number = DEFAULT_MAX_POOL_SIZE,
  minPoolSize: number = DEFAULT_MIN_POOL_SIZE,
): string {
  try {
    const url = new URL(databaseUrl);

    if (!url.searchParams.has('maxPoolSize')) {
      url.searchParams.set('maxPoolSize', String(maxPoolSize));
    }

    if (!url.searchParams.has('minPoolSize')) {
      url.searchParams.set('minPoolSize', String(minPoolSize));
    }

    return url.toString();
  } catch {
    return databaseUrl;
  }
}

/** O que está valendo, para o log do boot — sem expor credencial. */
export function describePool(databaseUrl: string): string {
  try {
    const { searchParams } = new URL(databaseUrl);
    return `maxPoolSize=${searchParams.get('maxPoolSize')}, minPoolSize=${searchParams.get('minPoolSize')}`;
  } catch {
    return 'não foi possível ler os parâmetros da URL';
  }
}
