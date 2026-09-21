/**
 * Eventos de atividade do usuário.
 *
 * Existem para desacoplar quem *faz* a ação de quem *reage* a ela. Sem isso,
 * o serviço de favoritos precisaria conhecer o de conquistas, o de anotações
 * também, e assim por diante — e cada novo consumidor obrigaria a mexer em
 * todos os módulos de origem.
 *
 * É o equivalente ao `trackActivity` do legado, que era chamado à mão em cada
 * rota e, na prática, quase nunca disparava a verificação de conquistas.
 */

export const ACTIVITY_TRACKED = 'activity.tracked';

/** Domínio da ação, usado para decidir o que precisa ser reavaliado. */
export type ActivityDomain =
  | 'favorites'
  | 'learning'
  | 'annotations'
  | 'contributions'
  | 'performance';

export class ActivityTrackedEvent {
  constructor(
    readonly userId: string,
    readonly domain: ActivityDomain,
    /** Ação concreta, para log e depuração. Ex.: `favorite.work.added`. */
    readonly action: string,
  ) {}
}
