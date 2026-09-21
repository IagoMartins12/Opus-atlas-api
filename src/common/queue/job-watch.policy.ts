import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';

export const ROLE_ADMIN = 1;
export const ROLE_SUPER_ADMIN = 2;

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
 * entrega é a mesma informação de `GET /admin/jobs/:queue/:jobId`, que exige
 * `SUPER_ADMIN`; se o gateway pedisse menos, a autorização da rota viraria
 * decoração — bastaria abrir o WebSocket para contornar.
 *
 * Só que exigir `SUPER_ADMIN` aqui deixaria a funcionalidade sem serventia
 * justamente para quem mais precisa dela: `POST /scrapers/:id/run` é
 * `@Roles('ADMIN')`, então um administrador comum **dispara** uma varredura de
 * dez minutos e não teria como ver se ela anda. A saída não é afrouxar a rota,
 * é usar o dado que o envelope de todo job já carrega: `requestedBy`.
 *
 * - `SUPER_ADMIN` acompanha qualquer job — é o que a rota REST já lhe dá.
 * - `ADMIN` acompanha **os jobs que ele mesmo pediu**, e nada além.
 *
 * Ninguém passa a ver nada que já não pudesse ver, e quem apertou o botão vê a
 * barra andar. Disparo automático (`requestedBy: null`) não tem dono, e por
 * isso continua restrito ao `SUPER_ADMIN`.
 */
export function watchRefusal(
  user: Pick<AccessTokenPayload, 'sub' | 'role'>,
  job: WatchableJob | null,
): string | null {
  if (!job) {
    return 'Job não encontrado — pode ter saído da janela de retenção';
  }

  if (user.role >= ROLE_SUPER_ADMIN) {
    return null;
  }

  if (user.role < ROLE_ADMIN) {
    return 'Você não tem permissão para acompanhar jobs';
  }

  if (job.requestedBy && job.requestedBy === user.sub) {
    return null;
  }

  return 'Este job foi pedido por outra pessoa. Só um super administrador acompanha jobs que não pediu.';
}

/** Nome da sala do socket.io que reúne quem observa um job. */
export function roomOf(queue: string, jobId: string): string {
  return `${queue}:${jobId}`;
}
