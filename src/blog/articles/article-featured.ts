import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Teto do carrossel de destaques, herdado do legado. */
export const MAX_FEATURED = 5;

export interface FeaturedFields {
  isFeatured?: boolean;
  featuredOrder?: number | null;
}

/** Menor posição livre do carrossel. */
export function firstFreeOrder(taken: readonly (number | null)[]): number {
  const used = new Set(taken);

  for (let order = 1; order <= MAX_FEATURED; order += 1) {
    if (!used.has(order)) {
      return order;
    }
  }

  return MAX_FEATURED;
}

/**
 * Os campos de destaque de um artigo, respeitando o teto.
 *
 * **Uma regra só, usada pela edição e pela rota de destaque.** No legado as
 * duas contavam o teto cada uma à sua maneira, e as duas davam posição `1` a
 * todo artigo novo no carrossel (`featuredOrder || 1`): cinco destaques
 * empatados na primeira posição, com a ordem decidida pelo acaso do banco.
 * Aqui o artigo entra na menor posição livre.
 *
 * Roda **dentro da transação** de quem chama: a contagem e a gravação precisam
 * ver o mesmo estado, ou dois administradores marcando ao mesmo tempo passam
 * os dois pelo teto.
 */
export async function featuredFields(
  tx: Prisma.TransactionClient,
  want: boolean | undefined,
  requestedOrder: number | undefined,
  current: { isFeatured: boolean; featuredOrder: number | null } | null,
): Promise<FeaturedFields> {
  if (want === undefined) {
    return {};
  }

  if (!want) {
    return { isFeatured: false, featuredOrder: null };
  }

  if (current?.isFeatured) {
    return requestedOrder ? { featuredOrder: requestedOrder } : {};
  }

  const featured = await tx.blogArticle.findMany({
    where: { isFeatured: true },
    select: { featuredOrder: true },
  });

  if (featured.length >= MAX_FEATURED) {
    throw new BadRequestException(
      `Limite de ${MAX_FEATURED} artigos em destaque atingido. Remova um para adicionar outro.`,
    );
  }

  return {
    isFeatured: true,
    featuredOrder:
      requestedOrder ??
      firstFreeOrder(featured.map((article) => article.featuredOrder)),
  };
}
