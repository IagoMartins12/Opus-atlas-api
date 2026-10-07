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

/**
 * Os mais frequentes de um campo, contados no banco.
 *
 * **Não use `groupBy` com `orderBy: { _count }` e `take` no MongoDB.** O
 * Prisma devolve grupos quaisquer: pedidos os três compositores com mais
 * obras, voltaram `[1, 3, 1]` — o de verdade tem 3.569. A ordenação e o corte
 * precisam acontecer dentro da agregação, e é o que esta função faz.
 *
 * `match` é o `$match` cru (datas em `{ $date: iso }`); `minimo` corta os
 * grupos com menos que isso.
 */
export async function topPorContagem(
  prisma: PrismaService,
  colecao: string,
  campo: string,
  opcoes: {
    limite: number;
    match?: Record<string, unknown>;
    minimo?: number;
  },
): Promise<Array<{ id: string; n: number }>> {
  const linhas = await runAggregate<{ _id: unknown; n: number }>(
    prisma,
    colecao,
    [
      ...(opcoes.match ? [{ $match: opcoes.match }] : []),
      { $group: { _id: `$${campo}`, n: { $sum: 1 } } },
      ...(opcoes.minimo ? [{ $match: { n: { $gte: opcoes.minimo } } }] : []),
      { $sort: { n: -1, _id: 1 } },
      { $limit: opcoes.limite },
    ],
  );
  return linhas
    .map((l) => ({ id: toObjectId(l._id) ?? String(l._id), n: l.n }))
    .filter((l) => l.id && l.id !== 'null');
}

/**
 * Quantos documentos entraram por mês, nos últimos `meses` (fuso de São
 * Paulo), com zero nos meses vazios — um gráfico que pula o mês sem nada
 * mente sobre o ritmo.
 */
export async function porMes(
  prisma: PrismaService,
  colecao: string,
  meses = 12,
  campo = 'createdAt',
): Promise<Array<{ mes: string; n: number }>> {
  const agora = new Date();
  const inicio = new Date(
    Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - (meses - 1), 1, 3),
  );
  const linhas = await runAggregate<{ _id: string; n: number }>(
    prisma,
    colecao,
    [
      { $match: { [campo]: { $gte: { $date: inicio.toISOString() } } } },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m',
              date: `$${campo}`,
              timezone: 'America/Sao_Paulo',
            },
          },
          n: { $sum: 1 },
        },
      },
    ],
  );
  const mapa = new Map(linhas.map((l) => [l._id, l.n]));

  return Array.from({ length: meses }, (_, i) => {
    const d = new Date(
      Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + i, 15),
    );
    const mes = d.toISOString().slice(0, 7);
    return { mes, n: mapa.get(mes) ?? 0 };
  });
}
