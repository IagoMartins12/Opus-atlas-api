import { ArticleStatus } from '@prisma/client';

export interface StatusFields {
  status: ArticleStatus;
  publishedAt: Date | null;
  scheduledFor: Date | null;
}

export class ArticleStatusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArticleStatusError';
  }
}

/** Ações da rota de publicação, no contrato do legado. */
export const PUBLISH_ACTIONS = ['publish', 'unpublish', 'schedule'] as const;

export type PublishAction = (typeof PUBLISH_ACTIONS)[number];

export function targetOf(action: PublishAction): ArticleStatus {
  switch (action) {
    case 'publish':
      return ArticleStatus.PUBLISHED;
    case 'unpublish':
      return ArticleStatus.DRAFT;
    case 'schedule':
      return ArticleStatus.SCHEDULED;
  }
}

/**
 * Os três campos de estado de um artigo, a partir do estado desejado.
 *
 * **No legado, cada rota decidia isso de um jeito.** A edição (`PUT`) mudava
 * `status` sem mexer em `scheduledFor`; a rota de publicação zerava as datas;
 * a aprovação publicava a partir de qualquer estado. Três lugares que sabem o
 * que "publicado" significa discordam na primeira mudança. Aqui toda troca de
 * estado — criação, edição, publicação, aprovação e agendamento — passa por
 * esta função. A varredura que publica os agendados usa `scheduledPublication`,
 * logo abaixo, pelo motivo explicado nela.
 *
 * - **Publicar um artigo já publicado não muda a data dele.** O legado
 *   regravava `publishedAt` a cada publicação: republicar para corrigir um
 *   erro levava a matéria de volta ao topo de "mais recentes", com data nova.
 * - **Agendar exige data futura.** O legado aceitava data passada, e o artigo
 *   ficava `SCHEDULED` para sempre com uma data que já tinha passado.
 * - **Rascunho e revisão tiram a data de publicação**, como a despublicação do
 *   legado fazia. Arquivar a mantém, como registro de quando esteve no ar.
 */
export function statusFields(
  current: StatusFields | null,
  target: ArticleStatus,
  scheduledFor: Date | null | undefined,
  now: Date,
): StatusFields {
  switch (target) {
    case ArticleStatus.PUBLISHED:
      return {
        status: target,
        publishedAt:
          current?.status === ArticleStatus.PUBLISHED && current.publishedAt
            ? current.publishedAt
            : now,
        scheduledFor: null,
      };

    case ArticleStatus.SCHEDULED:
      if (!scheduledFor) {
        throw new ArticleStatusError('Data de agendamento é obrigatória');
      }

      if (scheduledFor.getTime() <= now.getTime()) {
        throw new ArticleStatusError(
          'A data de agendamento já passou. Para pôr o artigo no ar agora, publique em vez de agendar.',
        );
      }

      return { status: target, publishedAt: null, scheduledFor };

    case ArticleStatus.ARCHIVED:
      return {
        status: target,
        publishedAt: current?.publishedAt ?? null,
        scheduledFor: null,
      };

    case ArticleStatus.DRAFT:
    case ArticleStatus.REVIEW:
    default:
      return { status: target, publishedAt: null, scheduledFor: null };
  }
}

/**
 * Publicação de um artigo agendado, feita pela varredura.
 *
 * **A data de publicação é a data agendada, não a hora em que a varredura
 * passou.** A varredura roda de minuto em minuto; se gravasse `now`, o atraso
 * dela viraria a data da matéria — e uma fila parada por uma hora publicaria
 * tudo com a data errada, fora da ordem que o autor planejou.
 */
export function scheduledPublication(scheduledFor: Date): StatusFields {
  return {
    status: ArticleStatus.PUBLISHED,
    publishedAt: scheduledFor,
    scheduledFor: null,
  };
}
