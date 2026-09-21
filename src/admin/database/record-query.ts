import { escapeRegex } from '../../common/utils/regex.util';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FieldInfo } from './field-policy';
import { ModelInfo, ModelRegistry } from './model-registry';

/**
 * Operadores aceitos no filtro.
 *
 * **Gramática fechada.** O legado fazia
 * `const filters = JSON.parse(searchParams.get('filters'))` e depois
 * `where[field] = value` — quer dizer, o objeto de consulta do Prisma vinha
 * pronto de fora. Qualquer operador que o Prisma entenda entrava, sobre
 * qualquer campo de qualquer um dos 70 models, inclusive os que a política
 * chama de protegidos. Com `hashedPassword` era possível sondar hashes por
 * `startsWith`, um caractere de cada vez, sem nunca lê-los.
 */
export const FILTER_OPERATORS = [
  'eq',
  'ne',
  'contains',
  'startsWith',
  'endsWith',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'isSet',
] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export interface RecordFilter {
  field: string;
  operator: FilterOperator;
  value?: unknown;
}

/** Campos de texto em que a busca livre procura. */
const TEXT_TYPES = new Set(['String']);

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const ENUM_VALUES = new Map<string, string[]>(
  Prisma.dmmf.datamodel.enums.map((enumType) => [
    enumType.name,
    enumType.values.map((value) => value.name),
  ]),
);

/**
 * Converte o valor recebido para o tipo do campo.
 *
 * Sem isto, `?filters=[{"field":"createdAt","operator":"gt","value":"ontem"}]`
 * chega ao Prisma como texto onde ele espera data e explode com uma mensagem
 * que descreve a consulta — que era, aliás, o que o legado devolvia ao cliente
 * em `details: error.message`.
 */
function coerce(field: FieldInfo, raw: unknown): unknown {
  if (raw === null) {
    return null;
  }

  switch (field.type) {
    case 'Int':
    case 'BigInt': {
      const parsed = Number(raw);

      if (!Number.isInteger(parsed)) {
        throw new BadRequestException(
          `"${field.name}" espera um inteiro; recebido ${JSON.stringify(raw)}.`,
        );
      }

      return parsed;
    }

    case 'Float':
    case 'Decimal': {
      const parsed = Number(raw);

      if (!Number.isFinite(parsed)) {
        throw new BadRequestException(
          `"${field.name}" espera um número; recebido ${JSON.stringify(raw)}.`,
        );
      }

      return parsed;
    }

    case 'Boolean': {
      if (typeof raw === 'boolean') {
        return raw;
      }

      if (raw === 'true' || raw === 'false') {
        return raw === 'true';
      }

      throw new BadRequestException(
        `"${field.name}" espera verdadeiro ou falso; recebido ${JSON.stringify(raw)}.`,
      );
    }

    case 'DateTime': {
      const parsed = new Date(String(raw));

      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException(
          `"${field.name}" espera uma data ISO; recebido ${JSON.stringify(raw)}.`,
        );
      }

      return parsed;
    }

    case 'Json':
      return raw;

    default: {
      const values = ENUM_VALUES.get(field.type);

      if (values && !values.includes(String(raw))) {
        throw new BadRequestException(
          `"${field.name}" aceita apenas: ${values.join(', ')}.`,
        );
      }

      return String(raw);
    }
  }
}

/** Operadores que só fazem sentido em texto. */
const TEXT_ONLY: FilterOperator[] = ['contains', 'startsWith', 'endsWith'];

function condition(field: FieldInfo, filter: RecordFilter): unknown {
  if (filter.operator === 'isSet') {
    // Ausente não é nulo no MongoDB, e a diferença já mordeu esta base antes:
    // `{ campo: null }` não casa com documento onde a chave nunca foi escrita.
    return { isSet: filter.value !== false };
  }

  if (TEXT_ONLY.includes(filter.operator)) {
    if (!TEXT_TYPES.has(field.type)) {
      throw new BadRequestException(
        `Operador "${filter.operator}" só vale para texto; "${field.name}" é ${field.type}.`,
      );
    }

    return {
      [filter.operator]: String(filter.value ?? ''),
      mode: 'insensitive',
    };
  }

  if (filter.operator === 'in') {
    if (!Array.isArray(filter.value)) {
      throw new BadRequestException(
        `Operador "in" espera uma lista em "${field.name}".`,
      );
    }

    return { in: filter.value.map((item) => coerce(field, item)) };
  }

  const value = coerce(field, filter.value);

  if (filter.operator === 'eq') {
    return value;
  }

  if (filter.operator === 'ne') {
    return { not: value };
  }

  return { [filter.operator]: value };
}

/**
 * Monta o `where` a partir dos filtros validados e da busca livre.
 *
 * Cada campo passa por `registry.field`, que recusa nome inexistente **e campo
 * protegido** — é o ponto onde a política de campos deixa de ser decorativa e
 * passa a valer também para quem só quer filtrar.
 */
export function buildWhere(
  registry: ModelRegistry,
  model: ModelInfo,
  input: { search?: string; filters?: RecordFilter[] },
): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  for (const filter of input.filters ?? []) {
    const field = registry.field(model, filter.field);
    where[field.name] = condition(field, filter);
  }

  const search = input.search?.trim();

  if (!search) {
    return where;
  }

  // Um ObjectId só pode ser o identificador: procurar por ele em campos de
  // texto seria varredura garantidamente vazia.
  if (OBJECT_ID.test(search)) {
    where[model.idField] = search;
    return where;
  }

  const textFields = model.fields.filter(
    (field) =>
      !field.isSecret &&
      !field.isList &&
      TEXT_TYPES.has(field.type) &&
      !field.isId,
  );

  if (textFields.length === 0) {
    throw new BadRequestException(
      `${model.name} não tem campo de texto para busca livre. Use filtros.`,
    );
  }

  where.OR = textFields.map((field) => ({
    [field.name]: { contains: escapeRegex(search), mode: 'insensitive' },
  }));

  return where;
}

/**
 * Monta a ordenação.
 *
 * O legado carregava uma lista escrita à mão dos "models sem `createdAt`" para
 * decidir entre ordenar por data ou por id — lista que precisava ser mantida a
 * cada model novo, e que já estava desatualizada. Aqui a pergunta é feita ao
 * próprio schema.
 */
export function buildOrderBy(
  registry: ModelRegistry,
  model: ModelInfo,
  sortField: string | undefined,
  direction: 'asc' | 'desc',
): Record<string, 'asc' | 'desc'> {
  if (sortField) {
    return { [registry.field(model, sortField).name]: direction };
  }

  const hasCreatedAt = model.fields.some(
    (field) => field.name === 'createdAt' && field.type === 'DateTime',
  );

  return hasCreatedAt
    ? { createdAt: 'desc' }
    : { [model.idField]: 'desc' as const };
}
