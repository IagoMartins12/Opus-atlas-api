import {
  classifyBassWork,
  instrumentMove,
  isFluteNotRecorder,
  workInstruments,
} from '../quality/work-instruments';
import { determinePrimaryInstrument } from '../../scrapers/imslp/imslp-work.parser';
import { chunks, type CatalogJobWork } from './job-types';

/** Obras lidas por vez na passada pela ficha. */
const PAGE = 5000;

/**
 * Conserta o instrumento principal das obras já gravadas (ver
 * `work-instruments.ts`):
 *
 *  1. as marcadas como contrabaixo por engano ("bassoon", "bass voice",
 *     orquestras) vão para o instrumento que a instrumentação cita;
 *  2. as flautas, que estavam em "Flauta Doce" porque o catálogo não tinha
 *     "Flauta", passam para ela (criada se faltar);
 *  3. toda obra cuja ficha desmente o instrumento vai para o que a ficha diz
 *     (`instrumentMove`). Obra verificada ou editada por pessoa não é tocada;
 *  4. toda obra recebe a lista completa dos seus instrumentos (`instrumentIds`),
 *     o principal primeiro: é por ela que os filtros procuram.
 *
 * O que não tem evidência fica como está e vai para a contagem final.
 *
 *   node dist/scripts/fix-work-instruments.js           # simula
 *   node dist/scripts/fix-work-instruments.js --apply   # grava
 */
export const work: CatalogJobWork = async ({ prisma, apply, logger }) => {
  const instruments = await prisma.instrument.findMany({
    select: { id: true, name: true },
  });
  const idOf = new Map(instruments.map((i) => [i.name, i.id]));
  const names = instruments.map((i) => i.name);

  const moves = new Map<string, string[]>(); // "de → para" → ids
  const add = (key: string, id: string) =>
    moves.set(key, [...(moves.get(key) ?? []), id]);
  const samples = new Map<string, string[]>();
  const sample = (key: string, title: string) => {
    const list = samples.get(key) ?? [];
    if (list.length < 3) samples.set(key, [...list, title]);
  };

  // 1. Contrabaixo
  const bass = idOf.get('Contrabaixo');
  let kept = 0;
  let unknown = 0;
  if (bass) {
    const works = await prisma.work.findMany({
      where: { instrumentId: bass },
      select: { id: true, title: true, instrumentation: true },
    });
    for (const w of works) {
      const verdict = classifyBassWork(
        w,
        names,
        determinePrimaryInstrument(w.title),
      );
      if (verdict.action === 'keep') kept++;
      else if (verdict.action === 'unknown') unknown++;
      else {
        const key = `Contrabaixo → ${verdict.to}`;
        add(key, w.id);
        sample(key, w.title);
      }
    }
  }

  // 2. Flauta transversal
  const recorder = idOf.get('Flauta Doce');
  if (recorder) {
    const works = await prisma.work.findMany({
      where: { instrumentId: recorder },
      select: { id: true, title: true, instrumentation: true },
    });
    for (const w of works) {
      if (!isFluteNotRecorder(w)) continue;
      add('Flauta Doce → Flauta', w.id);
      sample('Flauta Doce → Flauta', w.title);
    }
  }

  // 3. A ficha do IMSLP. Roda depois das duas: quem já vai mudar não entra.
  const moving = new Set([...moves.values()].flat());
  const nameOf = new Map(instruments.map((i) => [i.id, i.name]));
  const count = await prisma.work.count();
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.work.findMany({
      select: {
        id: true,
        title: true,
        instrumentId: true,
        instrumentation: true,
        isVerified: true,
        lastEditedBy: true,
      },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
    });
    if (!page.length) break;
    cursor = page[page.length - 1].id;
    for (const w of page) {
      if (w.isVerified || w.lastEditedBy || moving.has(w.id)) continue;
      const from = nameOf.get(w.instrumentId) ?? '?';
      const to = instrumentMove(w, from);
      if (!to || !idOf.has(to)) continue;
      const key = `${from} → ${to}`;
      add(key, w.id);
      sample(key, w.title);
    }
  }

  let total = 0;
  for (const [key, ids] of [...moves].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    total += ids.length;
    logger.log(
      `${ids.length}\t${key}\te.g. ${(samples.get(key) ?? []).join(' | ')}`,
    );
  }
  logger.log(
    `${total} de ${count} obra(s) a mover; ${kept} contrabaixo(s) de verdade; ${unknown} sem evidência (ficam)`,
  );
  if (!apply) return;

  if (
    [...moves.keys()].some((key) => key.endsWith('→ Flauta')) &&
    !idOf.has('Flauta')
  ) {
    const created = await prisma.instrument.create({
      data: { name: 'Flauta' },
    });
    idOf.set('Flauta', created.id);
    logger.log('Instrumento "Flauta" criado');
  }
  for (const [key, ids] of moves) {
    const to = idOf.get(key.split(' → ')[1]);
    if (!to) continue;
    // A command, not `updateMany`: `updatedAt` would make the IndexNow run
    // announce tens of thousands of pages at once.
    for (const part of chunks(ids)) {
      await prisma.$runCommandRaw({
        update: 'Work',
        updates: [
          {
            q: { _id: { $in: part.map((id) => ({ $oid: id })) } },
            u: { $set: { instrumentId: { $oid: to } } },
            multi: true,
          },
        ],
      });
    }
  }
  logger.log(`Gravado: ${total} obra(s)`);

  // 4. Todos os instrumentos, já com o principal novo.
  const groups = new Map<string, string[]>();
  let lists = 0;
  let after: string | undefined;
  for (;;) {
    const page = await prisma.work.findMany({
      select: {
        id: true,
        title: true,
        instrumentId: true,
        instrumentation: true,
        instrumentIds: true,
      },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(after && { skip: 1, cursor: { id: after } }),
    });
    if (!page.length) break;
    after = page[page.length - 1].id;
    for (const w of page) {
      const ids = [
        w.instrumentId,
        ...workInstruments(w, null)
          .map((name) => idOf.get(name))
          .filter((id): id is string => !!id),
      ];
      const unique = [...new Set(ids)];
      if (unique.join() === w.instrumentIds.join()) continue;
      lists++;
      const key = unique.join();
      groups.set(key, [...(groups.get(key) ?? []), w.id]);
    }
  }
  for (const [key, ids] of groups)
    for (const part of chunks(ids))
      await prisma.$runCommandRaw({
        update: 'Work',
        updates: [
          {
            q: { _id: { $in: part.map((id) => ({ $oid: id })) } },
            u: {
              $set: {
                instrumentIds: key.split(',').map((id) => ({ $oid: id })),
              },
            },
            multi: true,
          },
        ],
      });
  logger.log(`Instrumentos da obra: ${lists} lista(s) gravada(s)`);
};
