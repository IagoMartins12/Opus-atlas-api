import type { CatalogJobWork } from './job-types';

/**
 * Destaca na agenda do blog os três primeiros eventos publicados de cada um
 * dos próximos três meses (o primeiro em tamanho grande). Tira o destaque dos
 * que estavam marcados antes.
 */
export const work: CatalogJobWork = async ({ prisma, apply, logger }) => {
  const hoje = new Date();
  const plano: { id: string; ordem: number; grande: boolean }[] = [];
  for (let m = 0; m < 3; m++) {
    const inicio = new Date(
      Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + m, 1, 3),
    );
    const fim = new Date(
      Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + m + 1, 1, 3),
    );
    const eventos = await prisma.event.findMany({
      where: {
        status: 'PUBLISHED',
        startDate: { gte: m === 0 ? hoje : inicio, lt: fim },
      },
      orderBy: { startDate: 'asc' },
      take: 3,
      select: { id: true },
    });
    eventos.forEach((e, i) =>
      plano.push({ id: e.id, ordem: i + 1, grande: i === 0 }),
    );
  }
  const antes = await prisma.event.count({ where: { isFeatured: true } });
  logger.log(
    `${plano.length} evento(s) a destacar (hoje há ${antes} destacado[s])`,
  );
  const outcome = {
    summary: { aDestacar: plano.length, destacadosAntes: antes },
  };
  if (!apply) return outcome;

  await prisma.event.updateMany({
    where: { isFeatured: true },
    data: { isFeatured: false, featuredOrder: null, featuredSize: null },
  });
  for (const e of plano) {
    await prisma.event.update({
      where: { id: e.id },
      data: {
        isFeatured: true,
        featuredOrder: e.ordem,
        featuredSize: e.grande ? 'large' : 'normal',
      },
    });
  }
  logger.log(`Gravado: ${plano.length} destaque(s)`);
  return outcome;
};
