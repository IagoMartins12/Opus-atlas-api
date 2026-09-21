import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Qual arquivo `.env` cada ambiente lê.
 *
 * `APP_ENV` escolhe o **arquivo**; `NODE_ENV`, que vem de dentro dele, escolhe o
 * **comportamento** (chave do Stripe de teste ou de produção, variáveis
 * obrigatórias, Swagger). São duas coisas: o ambiente de homologação roda com
 * `NODE_ENV=staging` — cobra no Stripe de teste — mas lê os endereços da
 * homologação, não os da máquina de quem desenvolve.
 *
 * | `APP_ENV` | arquivo      | `NODE_ENV` esperado |
 * |-----------|--------------|---------------------|
 * | `local`   | `.env.local` | `development`       |
 * | `hml`     | `.env.hml`   | `staging`           |
 * | `prd`     | `.env.prd`   | `production`        |
 *
 * **Um arquivo só por ambiente, sem cair noutro para o que faltar.** Se a
 * homologação herdasse do local o que esqueceu de declarar, subiria apontando
 * para o banco da máquina de alguém. Faltando variável obrigatória, a validação
 * do boot recusa subir e diz qual.
 *
 * **Por que não existe `.env`.** O Prisma Client, ao ser importado, carrega
 * sozinho o `.env` da raiz para o `process.env` — antes do `ConfigModule`, e
 * variável do processo vence o arquivo. Com um `.env` local presente, o
 * `.env.prd` subiria com o `DATABASE_URL` da máquina de desenvolvimento. Por
 * isso o local é `.env.local`, e o boot recusa subir se um `.env` reaparecer
 * (`assertNoRootDotEnv`). Os comandos do Prisma CLI recebem o arquivo
 * explicitamente (`npm run prisma:push`).
 *
 * Variável já definida no processo sempre vence o arquivo — é assim que o
 * contêiner de produção recebe os segredos do orquestrador sem arquivo nenhum.
 */
export const APP_ENVS = ['local', 'hml', 'prd'] as const;

export type AppEnv = (typeof APP_ENVS)[number];

export const EXPECTED_NODE_ENV: Record<AppEnv, string> = {
  local: 'development',
  hml: 'staging',
  prd: 'production',
};

export function appEnvOf(env: NodeJS.ProcessEnv = process.env): AppEnv {
  const value = (env.APP_ENV ?? 'local').trim().toLowerCase();

  if (!(APP_ENVS as readonly string[]).includes(value)) {
    throw new Error(
      `APP_ENV inválido: "${env.APP_ENV}". Use ${APP_ENVS.join(', ')}.`,
    );
  }

  return value as AppEnv;
}

export function envFileOf(appEnv: AppEnv): string {
  return `.env.${appEnv}`;
}

/**
 * Recusa subir com um `.env` na raiz — ver o comentário do arquivo. O erro
 * aparece no boot, em vez de a produção rodar em silêncio com o banco local.
 */
export function assertNoRootDotEnv(
  cwd = process.cwd(),
  exists: (path: string) => boolean = existsSync,
): void {
  if (exists(resolve(cwd, '.env'))) {
    throw new Error(
      'Há um arquivo .env na raiz da API. O Prisma Client o carrega sozinho e ' +
        'ele se misturaria com o ambiente escolhido — renomeie para .env.local ' +
        '(ou .env.hml / .env.prd). Ver src/config/env-files.ts.',
    );
  }
}

/** Resolve o arquivo do ambiente, conferindo antes que não há `.env` solto. */
export function envFilePath(): string {
  assertNoRootDotEnv();
  return envFileOf(appEnvOf());
}
