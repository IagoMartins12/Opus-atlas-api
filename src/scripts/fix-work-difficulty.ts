import { difficultyFix } from '../catalog/quality/work-difficulty';
import { chunks, runCatalogScript } from './catalog-script';

/**
 * Corrige a dificuldade das obras sem fonte (ver `work-difficulty.ts`): estudo
 * de virtuose sobe para avançado, e iniciante sem sinal no título fica vazio.
 * Obra verificada ou editada por uma pessoa não é tocada.
 *
 *   node dist/scripts/fix-work-difficulty.js           # simula
 *   node dist/scripts/fix-work-difficulty.js --apply   # grava
 */
void runCatalogScript(
  'FixWorkDifficulty',
  async ({ prisma, apply, logger }) => {
    const works = await prisma.work.findMany({
      where: {
        difficultyLevel: { in: ['BEGINNER', 'INTERMEDIATE'] },
        isVerified: false,
        lastEditedBy: null,
      },
      select: {
        id: true,
        title: true,
        difficultyLevel: true,
        composer: { select: { name: true } },
      },
    });

    const raise: string[] = [];
    const clear: string[] = [];
    const sample = new Map<string, string[]>();
    for (const w of works) {
      const fix = difficultyFix({
        title: w.title,
        composerName: w.composer.name,
        level: w.difficultyLevel,
      });
      if (!fix) continue;
      (fix.action === 'raise' ? raise : clear).push(w.id);
      const key = `${w.difficultyLevel} → ${fix.action === 'raise' ? 'ADVANCED' : 'vazio'} (${fix.reason})`;
      const list = sample.get(key) ?? [];
      if (list.length < 5) list.push(`${w.composer.name}: ${w.title}`);
      sample.set(key, list);
    }

    for (const [key, list] of sample)
      logger.log(`${key}\n  ${list.join('\n  ')}`);
    logger.log(
      `${works.length} obra(s) examinadas; ${raise.length} sobem para avançado, ${clear.length} ficam sem dificuldade`,
    );
    if (!apply) return;

    for (const part of chunks(raise))
      await prisma.work.updateMany({
        where: { id: { in: part } },
        data: { difficultyLevel: 'ADVANCED' },
      });
    for (const part of chunks(clear))
      await prisma.work.updateMany({
        where: { id: { in: part } },
        data: { difficultyLevel: null },
      });
    logger.log(`Gravado: ${raise.length} + ${clear.length} obra(s)`);
  },
);
