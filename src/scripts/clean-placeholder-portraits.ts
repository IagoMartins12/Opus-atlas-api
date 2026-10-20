import { runCatalogScript } from './catalog-script';

/**
 * O "sem foto" do IMSLP (`Nocomposerphotoavailable.jpg`) estava gravado como
 * retrato de milhares de compositores. O site já o trata como "sem retrato",
 * mas as contas de "com retrato" e a curadoria ficavam erradas. Aqui ele vira
 * ausência de retrato (`null`) — a raspagem nova já não o grava.
 *
 *   node dist/scripts/clean-placeholder-portraits.js           # simula
 *   node dist/scripts/clean-placeholder-portraits.js --apply   # grava
 */
void runCatalogScript(
  'CleanPlaceholderPortraits',
  async ({ prisma, apply, logger }) => {
    const where = {
      portraitUrl: {
        contains: 'Nocomposerphotoavailable',
        mode: 'insensitive' as const,
      },
    };
    const total = await prisma.composer.count({ where });
    logger.log(
      `${total} compositor(es) com o "sem foto" do IMSLP como retrato`,
    );
    if (!apply) return;

    const done = await prisma.composer.updateMany({
      where,
      data: { portraitUrl: null },
    });
    logger.log(`Gravado: ${done.count} retrato(s) limpos`);
  },
);
