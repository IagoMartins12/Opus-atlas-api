/**
 * Os níveis de `User.role` — **uma fonte só**.
 *
 * | Nível | Quem é | O que abre |
 * |---|---|---|
 * | 0 | pessoa comum | nada de administrativo |
 * | 1 | **professor** | nada de administrativo |
 * | 2 | **administrador** | o painel inteiro |
 *
 * **O nível 1 não dá acesso administrativo.** Ele veio do legado, onde `1`
 * marcava professor; na migração virou o nível de `ADMIN` na checagem de
 * permissão, e como o guard compara `role >= exigido`, **toda conta que o
 * painel antigo promoveu a professor passou a abrir rotas administrativas** —
 * anúncios, métricas, moderação, catálogo. Ser professor é `isTeacher`, campo
 * próprio; papel é outra coisa.
 *
 * Este arquivo existe porque o número estava escrito à mão em quatro lugares
 * (`roles.guard`, `job-watch.policy`, `moderation-sweep`, `comments.service`),
 * cada um com o seu `const ROLE_ADMIN = 1`. Foi assim que o engano se
 * espalhou: corrigir um não corrigia os outros.
 */
export const ROLE = {
  USER: 0,
  TEACHER: 1,
  ADMIN: 2,
} as const;

export type RoleLevel = (typeof ROLE)[keyof typeof ROLE];

/**
 * Nomes usados em `@Roles(...)` e o nível mínimo de cada um.
 *
 * `SUPER_ADMIN` continua aceito e hoje **vale o mesmo que `ADMIN`**: não há
 * nível acima de 2. Os dois nomes seguem porque as rotas se dividem entre
 * eles, e a distinção ainda diz a intenção de quem escreveu — se um dia
 * existir um nível 3, é aqui que ele entra, sem caçar decorator por decorator.
 */
export const ROLE_NAME_TO_LEVEL: Record<string, number> = {
  USER: ROLE.USER,
  TEACHER: ROLE.TEACHER,
  ADMIN: ROLE.ADMIN,
  SUPER_ADMIN: ROLE.ADMIN,
};

/** Tem acesso ao painel administrativo? */
export function isAdmin(role: number | undefined | null): boolean {
  return (role ?? ROLE.USER) >= ROLE.ADMIN;
}
