import { correctedEpoch } from '../quality/composer-epoch';
import { chunks, type CatalogJobWork } from './job-types';

/**
 * Corrige a época dos compositores pelas datas (ver `composer-epoch.ts`).
 * Troca a época do compositor e a das obras dele que carregavam a época
 * errada. Quem não tem ano de nascimento não é tocado.
 *
 *   node dist/scripts/fix-composer-epochs.js           # simula
 *   node dist/scripts/fix-composer-epochs.js --apply   # grava
 */
export const work: CatalogJobWork = async ({ prisma, apply, logger }) => {
  const epochs = await prisma.epoch.findMany({
    select: { id: true, name: true },
  });
  const byName = new Map(epochs.map((e) => [e.name, e.id]));

  const composers = await prisma.composer.findMany({
    where: { birthYear: { not: null } },
    select: {
      id: true,
      name: true,
      epochId: true,
      epochName: true,
      birthYear: true,
    },
  });

  const moves = new Map<
    string,
    { id: string; name: string; from: string; fromId: string }[]
  >();
  for (const c of composers) {
    const to = correctedEpoch(c.epochName, c.birthYear);
    if (!to || !byName.has(to)) continue;
    const key = `${c.epochName} → ${to}`;
    moves.set(key, [
      ...(moves.get(key) ?? []),
      { id: c.id, name: c.name, from: c.epochName ?? '', fromId: c.epochId },
    ]);
  }

  let total = 0;
  for (const [key, list] of [...moves].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    total += list.length;
    logger.log(
      `${list.length}\t${key}\te.g. ${list
        .slice(0, 4)
        .map((c) => c.name)
        .join(', ')}`,
    );
  }
  logger.log(`${total} compositor(es) com a época fora das datas`);
  if (!apply) return;

  let works = 0;
  for (const [key, list] of moves) {
    const to = key.split(' → ')[1];
    const toId = byName.get(to)!;
    for (const part of chunks(list)) {
      const ids = part.map((c) => c.id);
      await prisma.composer.updateMany({
        where: { id: { in: ids } },
        data: { epochId: toId, epochName: to },
      });
      // As obras que carregavam a época antiga do compositor seguem com ele;
      // as que o IMSLP já pôs noutra época ficam como estão.
      const fromId = part[0].fromId;
      const moved = await prisma.work.updateMany({
        where: { composerId: { in: ids }, epochId: fromId },
        data: { epochId: toId },
      });
      works += moved.count;
    }
  }
  logger.log(`Gravado: ${total} compositor(es), ${works} obra(s)`);
};
