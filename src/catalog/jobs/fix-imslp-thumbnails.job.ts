import { type CatalogJobWork } from './job-types';

/**
 * Corrige as miniaturas de partitura gravadas pelo legado como `https:////cdn…`.
 *
 * O raspador do legado fazia `https://` + um endereço que já começava com `//`.
 * Navegadores toleram as barras a mais; outros clientes (e `new URL` em alguns
 * contextos, e comparação de string) não. O raspador novo grava certo
 * (`absoluteImslpUrl`); este script conserta o que já está no banco, numa
 * atualização só no servidor do Mongo.
 *
 * Uso (com `QUEUE_ROLE=api`):
 *   node dist/scripts/fix-imslp-thumbnails.js            # simulação
 *   node dist/scripts/fix-imslp-thumbnails.js --apply    # aplica
 */

const BROKEN = /^https:\/\/\/\//;

export const work: CatalogJobWork = async ({ prisma, apply, logger }) => {
  const filter = { thumbnailUrl: { $regex: BROKEN.source } };
  const counted = (await prisma.$runCommandRaw({
    count: 'work_scores',
    query: filter,
  })) as unknown as { n: number };

  logger.log(
    `${apply ? 'Corrigindo' : '[simulação] corrigiria'} ${counted.n} miniatura(s)`,
  );

  if (apply && counted.n > 0) {
    const result = (await prisma.$runCommandRaw({
      update: 'work_scores',
      updates: [
        {
          q: filter,
          // Pipeline de atualização: troca o começo no próprio servidor.
          u: [
            {
              $set: {
                thumbnailUrl: {
                  $concat: [
                    'https://',
                    { $substrCP: ['$thumbnailUrl', 10, 100000] },
                  ],
                },
              },
            },
          ],
          multi: true,
        },
      ],
    })) as unknown as { nModified: number };

    logger.log(`Corrigidas: ${result.nModified}`);
  }
};
