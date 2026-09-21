import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Executa uma pipeline de agregação do MongoDB.
 *
 * O Prisma tipado não expõe `$lookup`, `$facet` nem `$dateToString`, que são
 * exatamente as etapas que permitem cruzar coleções e agrupar por período
 * **dentro do banco** — a alternativa é trazer centenas de milhares de
 * documentos para a memória do processo, que foi o que o legado fez.
 */
export async function runAggregate<T>(
  prisma: PrismaService,
  collection: string,
  pipeline: Record<string, unknown>[],
): Promise<T[]> {
  const result = (await prisma.$runCommandRaw({
    aggregate: collection,
    pipeline,
    cursor: {},
    allowDiskUse: true,
  } as unknown as Prisma.InputJsonObject)) as unknown as {
    cursor: { firstBatch: T[] };
  };

  return result.cursor.firstBatch;
}

/**
 * Converte um `_id` vindo da agregação crua em `string`.
 *
 * `$runCommandRaw` devolve JSON estendido do MongoDB, então um `ObjectId` chega
 * como `{ "$oid": "685e1087..." }` — e não como o texto que o Prisma usa em
 * todas as outras consultas. Passar esse objeto adiante para um
 * `where: { id: { in: [...] } }` faz a consulta falhar; pior, num campo de
 * texto ela não falha, só não encontra nada.
 */
export function toObjectId(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    '$oid' in value &&
    typeof (value as { $oid: unknown }).$oid === 'string'
  ) {
    return (value as { $oid: string }).$oid;
  }

  return null;
}
