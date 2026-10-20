import { garantirCategoriasETags } from './blog-seed-data';
import type { CatalogJobWork } from './job-types';

/**
 * Cria (ou atualiza pelo slug) as categorias e as tags do blog: nome, nome em
 * inglês, descrição, ordem, atalho no menu "Categorias" e seção no início.
 * As categorias que já existiam (Barroco, Clássico, Romântico) são mantidas;
 * o Romântico só ganha a seção no início. Sem artigos, sem autores.
 */
export const work: CatalogJobWork = async ({ prisma, apply, logger }) => {
  const r = await garantirCategoriasETags(prisma, apply);
  logger.log(
    `${apply ? 'Gravado' : '[simulação]'}: categorias ${r.categoriasNovas} novas e ${r.categoriasAtualizadas} atualizadas; tags ${r.tagsNovas} novas e ${r.tagsAtualizadas} atualizadas`,
  );
  return { summary: r };
};
