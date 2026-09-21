/**
 * Árvore de comentários, montada em memória a partir de uma consulta só.
 *
 * **O legado fazia uma consulta por comentário, recursivamente.** A listagem
 * buscava os comentários de topo e, para cada um, as respostas; para cada
 * resposta, as respostas dela; e em cada nível mais uma consulta de curtidas.
 * Um artigo com cem comentários eram duzentas idas ao banco para uma página. O
 * mesmo padrão estava na thread do painel e na exclusão em cascata.
 */

export interface TreeComment {
  id: string;
  parentId: string | null;
  createdAt: Date;
  likeCount: number;
}

export type WithReplies<T> = T & { replies: WithReplies<T>[] };

export const COMMENT_SORTS = ['newest', 'oldest', 'mostLiked'] as const;

export type CommentSort = (typeof COMMENT_SORTS)[number];

function compareTop(sort: CommentSort) {
  return (a: TreeComment, b: TreeComment): number => {
    if (sort === 'mostLiked' && a.likeCount !== b.likeCount) {
      return b.likeCount - a.likeCount;
    }

    const byDate = a.createdAt.getTime() - b.createdAt.getTime();
    return sort === 'oldest' ? byDate : -byDate;
  };
}

const byCreatedAsc = (a: TreeComment, b: TreeComment) =>
  a.createdAt.getTime() - b.createdAt.getTime();

/**
 * Monta a árvore.
 *
 * **Resposta de comentário escondido some junto com ele**, como no legado: se
 * o comentário de cima foi reprovado, a conversa embaixo dele perde o
 * contexto, e promover as respostas a comentário de topo as mostraria
 * respondendo a nada. Os de topo seguem a ordenação pedida; as respostas, em
 * qualquer nível, ficam em ordem cronológica, que é como uma conversa se lê.
 */
export function buildCommentTree<T extends TreeComment>(
  comments: T[],
  sort: CommentSort,
  isVisible: (comment: T) => boolean = () => true,
): WithReplies<T>[] {
  const byParent = new Map<string | null, T[]>();

  for (const comment of comments.filter(isVisible)) {
    const key = comment.parentId ?? null;
    const siblings = byParent.get(key) ?? [];
    siblings.push(comment);
    byParent.set(key, siblings);
  }

  const visited = new Set<string>();

  const attach = (comment: T): WithReplies<T> => {
    visited.add(comment.id);

    const children = (byParent.get(comment.id) ?? [])
      .filter((child) => !visited.has(child.id))
      .sort(byCreatedAsc);

    return { ...comment, replies: children.map(attach) };
  };

  return (byParent.get(null) ?? []).sort(compareTop(sort)).map(attach);
}

/**
 * O que sai do banco quando um comentário **sem respostas** é apagado.
 *
 * O próprio comentário, e depois os marcadores acima dele que ficaram sem
 * razão de existir: um "Comentário removido" só se mantém enquanto houver
 * resposta embaixo dele. Apagar a última resposta de um marcador leva o
 * marcador junto — e, se o de cima também era marcador e ficou vazio, ele
 * também. A ordem é de baixo para cima, porque a relação entre comentário e
 * resposta no schema é `NoAction`: apagar um pai com filho de pé pode ser
 * recusado.
 */
export function removalChain(
  comments: { id: string; parentId: string | null; deletedAt: Date | null }[],
  id: string,
): string[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const chain = [id];
  const gone = new Set(chain);
  let parentId = byId.get(id)?.parentId ?? null;

  while (parentId && !gone.has(parentId)) {
    const parent = byId.get(parentId);

    if (!parent?.deletedAt) {
      break;
    }

    const stillAnswered = comments.some(
      (comment) => comment.parentId === parentId && !gone.has(comment.id),
    );

    if (stillAnswered) {
      break;
    }

    chain.push(parentId);
    gone.add(parentId);
    parentId = parent.parentId;
  }

  return chain;
}

/** O comentário de topo de uma conversa. */
export function rootOf(
  comments: { id: string; parentId: string | null }[],
  id: string,
): string {
  const parents = new Map(
    comments.map((comment) => [comment.id, comment.parentId]),
  );
  const seen = new Set<string>();
  let cursor = id;

  while (!seen.has(cursor)) {
    seen.add(cursor);
    const parent = parents.get(cursor);

    if (!parent || !parents.has(parent)) {
      return cursor;
    }

    cursor = parent;
  }

  return cursor;
}
