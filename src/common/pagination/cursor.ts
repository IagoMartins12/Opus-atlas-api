/**
 * Paginação das listas grandes do painel.
 *
 * `skip` relê e descarta tudo o que veio antes: na página 200 de usuários o
 * banco varre 5.000 documentos para devolver 25. E, entre uma página e outra,
 * um cadastro novo empurra um registro para a página seguinte — quem rola a
 * lista vê o mesmo item duas vezes, ou não vê nenhum. Com cursor, o banco
 * continua do último id que a tela recebeu.
 *
 * **A ordenação precisa do id como desempate** (`[{ campo }, { id }]`): com
 * dois registros do mesmo instante, a ordem entre eles não é estável, e o
 * cursor pula ou repete.
 */
export interface PageArgs {
  take: number;
  skip: number;
  cursor?: { id: string };
}

/**
 * Os argumentos de recorte do Prisma, no modo que a chamada pediu: continua do
 * cursor (descartando o próprio, daí o `skip: 1`) ou salta até a página.
 *
 * O retorno é anotado de propósito: sem a anotação, TypeScript infere uma
 * união de dois formatos e o `findMany` recusa o espalhamento.
 */
export function pageArgs(params: {
  cursor?: string;
  page: number;
  limit: number;
}): PageArgs {
  const { cursor, page, limit } = params;

  return cursor
    ? { cursor: { id: cursor }, skip: 1, take: limit }
    : { skip: (page - 1) * limit, take: limit };
}

/**
 * O cursor da próxima página: o id do último item, ou `null` quando a página
 * veio incompleta — aí não há mais o que buscar.
 */
export function nextCursorOf<T extends { id: string }>(
  items: T[],
  limit: number,
): string | null {
  return items.length === limit ? items[items.length - 1].id : null;
}
