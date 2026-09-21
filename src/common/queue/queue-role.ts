/**
 * Papel do processo em relação à fila.
 *
 * O `Dockerfile` já tinha dois alvos de runtime (`api` e `worker`) desde a
 * Etapa 0, e até aqui os dois rodavam exatamente o mesmo processo — o alvo
 * `worker` existia só para carregar o Chromium. Esta variável é o que
 * finalmente os diferencia.
 *
 * - `api`    — só **enfileira**. Não abre worker nenhum, então o tráfego HTTP
 *              nunca disputa CPU com uma varredura de scraping ou um envio de
 *              dez mil e-mails.
 * - `worker` — só **consome**. Não expõe rota.
 * - `all`    — os dois no mesmo processo.
 *
 * O padrão é `all`, e isso é deliberado: quem sobe um contêiner só, ou roda
 * `npm run start:dev` na própria máquina, precisa que a fila funcione sem
 * configurar nada. A separação é opt-in, feita pelo alvo da imagem.
 */
export type QueueRole = 'api' | 'worker' | 'all';

export const QUEUE_ROLES: readonly QueueRole[] = ['api', 'worker', 'all'];

const DEFAULT_ROLE: QueueRole = 'all';

/**
 * Lê `QUEUE_ROLE` do ambiente.
 *
 * **Valor desconhecido derruba o boot**, de propósito. Um `QUEUE_ROLE=workr`
 * silenciosamente tratado como padrão daria um cluster inteiro onde ninguém
 * consome fila: as rotas continuam respondendo 202, os jobs continuam
 * entrando, e nada nunca acontece. Esse é o tipo de falha que só aparece
 * quando alguém pergunta por que a campanha de terça não saiu.
 */
export function resolveQueueRole(
  env: NodeJS.ProcessEnv = process.env,
): QueueRole {
  const raw = env.QUEUE_ROLE?.trim().toLowerCase();

  if (!raw) {
    return DEFAULT_ROLE;
  }

  if (!QUEUE_ROLES.includes(raw as QueueRole)) {
    throw new Error(
      `QUEUE_ROLE inválido: "${env.QUEUE_ROLE}". Use ${QUEUE_ROLES.join(', ')}.`,
    );
  }

  return raw as QueueRole;
}

/** Este processo registra os processors? */
export function runsWorkers(env: NodeJS.ProcessEnv = process.env): boolean {
  const role = resolveQueueRole(env);
  return role === 'worker' || role === 'all';
}

/** Este processo atende HTTP? */
export function servesHttp(env: NodeJS.ProcessEnv = process.env): boolean {
  const role = resolveQueueRole(env);
  return role === 'api' || role === 'all';
}
