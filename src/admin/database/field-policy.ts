import { Prisma } from '@prisma/client';

/**
 * Política de campos do navegador de banco.
 *
 * **O legado tinha esta política e não a aplicava onde o dado passa.**
 * `databaseConfig.ts` declarava `sensitiveFields` por model, e quem importava
 * esse arquivo era só a rota `/schema`, que *descreve* campos. As rotas
 * `/records` e `/export`, que **entregam o conteúdo**, não o importavam:
 * `GET /admin/database/records?model=user` devolvia `hashedPassword` de toda a
 * base, paginado, porque sem `fields` na query o `select` ficava `undefined` e
 * o Prisma retornava o documento inteiro.
 *
 * E a lista, mesmo se aplicada, cobria três models. `UserToken.token` — o token
 * de reset de senha e de confirmação de e-mail — **não estava nela**, nem os
 * tokens da newsletter.
 *
 * Por isso aqui a regra é **por padrão de nome, não por lista**: um model novo
 * com um campo `token` nasce protegido, sem ninguém precisar lembrar de
 * cadastrá-lo. Lista fechada falha em silêncio no dia em que o schema cresce;
 * padrão de nome falha para o lado seguro.
 */
const SECRET_NAME = /password|secret|token|apikey|api_key|credential|hash/i;

/**
 * Exceções ao padrão, para campos que casam com o nome e não são segredo.
 *
 * Vazio de propósito. `Account.token_type` guarda `"bearer"` e
 * `Notification.uniqueHash` é chave de deduplicação — nenhum dos dois é
 * segredo, mas nenhum dos dois é necessário no navegador de banco. Manter a
 * exceção vazia é o lado certo de errar: o custo de bloquear um campo inócuo é
 * não vê-lo aqui; o custo de liberar um campo sensível é vazamento.
 */
const NOT_SECRET: readonly string[] = [];

/** Tipos de campo que o navegador sabe exibir e filtrar. */
const READABLE_KINDS = new Set(['scalar', 'enum']);

export interface FieldInfo {
  name: string;
  /** Tipo Prisma: `String`, `Int`, `DateTime`, `Boolean`, `Json`, ou um enum. */
  type: string;
  kind: string;
  isList: boolean;
  isRequired: boolean;
  isId: boolean;
  /** Gerado pelo banco ou pelo Prisma — nunca aceito na escrita. */
  isGenerated: boolean;
  /** Casa com o padrão de segredo: nunca lido, nunca escrito. */
  isSecret: boolean;
}

export function isSecretField(name: string): boolean {
  return SECRET_NAME.test(name) && !NOT_SECRET.includes(name);
}

/**
 * Campos escalares de um model, já classificados.
 *
 * Relações ficam de fora: `User.tokens` casa com o padrão de segredo por
 * acidente do nome, mas o que importa é que uma relação não é dado a exibir
 * numa tabela — é outro model, com política própria.
 */
export function describeFields(model: Prisma.DMMF.Model): FieldInfo[] {
  return model.fields
    .filter((field) => READABLE_KINDS.has(field.kind))
    .map((field) => ({
      name: field.name,
      type: field.type,
      kind: field.kind,
      isList: field.isList,
      isRequired: field.isRequired,
      isId: field.isId ?? false,
      isGenerated:
        (field.isGenerated ?? false) ||
        (field.isUpdatedAt ?? false) ||
        field.hasDefaultValue,
      isSecret: isSecretField(field.name),
    }));
}

/** Campos que podem sair na resposta. */
export function readableFields(fields: FieldInfo[]): FieldInfo[] {
  return fields.filter((field) => !field.isSecret);
}

/**
 * `select` explícito com os campos legíveis.
 *
 * **Nunca devolve `undefined`.** Era exatamente esse `undefined` que fazia o
 * legado entregar o documento inteiro: `buildSelectClause` devolvia `undefined`
 * quando ninguém pedia campos, e "todos os campos" incluía os segredos.
 */
export function buildSelect(
  fields: FieldInfo[],
  requested?: string[],
): Record<string, true> {
  const allowed = new Set(readableFields(fields).map((field) => field.name));

  const chosen =
    requested && requested.length > 0
      ? requested.filter((name) => allowed.has(name))
      : [...allowed];

  const select: Record<string, true> = {};

  for (const name of chosen) {
    select[name] = true;
  }

  // O id sempre volta: sem ele a linha não é endereçável para editar ou apagar.
  const idField = fields.find((field) => field.isId);

  if (idField) {
    select[idField.name] = true;
  }

  return select;
}
