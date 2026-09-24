import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';

import { ROLE } from '../auth/roles';

export const ROLE_ADMIN = ROLE.ADMIN;

/** Teto de jobs observados por conexão. */
export const MAX_WATCHES_PER_SOCKET = 20;

export interface WatchableJob {
  /** Id de quem pediu o job, do envelope. `null` em disparo automático. */
  requestedBy: string | null;
}

/**
 * Diz por que este usuário não pode acompanhar este job — ou `null`.
 *
 * **O socket não pode ser uma porta mais larga do que a rota REST.** O que ele
 * entrega é a mesma informação de `GET /admin/jobs/:queue/:jobId`; se o
 * gateway pedisse menos, a autorização da rota viraria decoração — bastaria
 * abrir o WebSocket para contornar.
 *
 * **A regra era mais fina e deixou de precisar ser.** Enquanto `ADMIN` valia
 * `role: 1` e `SUPER_ADMIN` valia 2, havia dois graus de administrador: o de
 * nível 1 disparava uma varredura (`POST /scrapers/:id/run` é `@Roles('ADMIN')`)
 * mas não podia ver a rota REST do job, então o socket lhe dava só os jobs que
 * ele mesmo tinha pedido, por `requestedBy`. Com o nível 1 devolvido ao
 * professor — que não tem acesso administrativo nenhum —, **todo mundo que
 * passa por aqui é nível 2**, e a distinção não separa mais ninguém.
 *
 * `requestedBy` continua no envelope: é quem a auditoria lê, e é o que traria
 * a regra de volta se um dia existir um nível 3.
 */
export function watchRefusal(
  user: Pick<AccessTokenPayload, 'sub' | 'role'>,
  job: WatchableJob | null,
): string | null {
  if (!job) {
    return 'Job não encontrado — pode ter saído da janela de retenção';
  }

  if (user.role < ROLE_ADMIN) {
    return 'Você não tem permissão para acompanhar jobs';
  }

  return null;
}

/** Nome da sala do socket.io que reúne quem observa um job. */
export function roomOf(queue: string, jobId: string): string {
  return `${queue}:${jobId}`;
}
