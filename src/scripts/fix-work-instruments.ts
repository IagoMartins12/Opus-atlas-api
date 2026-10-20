import {
  classifyBassWork,
  isFluteNotRecorder,
} from '../catalog/quality/work-instruments';
import { determinePrimaryInstrument } from '../scrapers/imslp/imslp-work.parser';
import { chunks, runCatalogScript } from './catalog-script';

/**
 * Conserta o instrumento principal das obras já gravadas (ver
 * `work-instruments.ts`):
 *
 *  1. as marcadas como contrabaixo por engano ("bassoon", "bass voice",
 *     orquestras) vão para o instrumento que a instrumentação cita;
 *  2. as flautas, que estavam em "Flauta Doce" porque o catálogo não tinha
 *     "Flauta", passam para ela (criada se faltar).
 *
 * O que não tem evidência fica como está e vai para a contagem final.
 *
 *   node dist/scripts/fix-work-instruments.js           # simula
 *   node dist/scripts/fix-work-instruments.js --apply   # grava
 */
void runCatalogScript(
  'FixWorkInstruments',
  async ({ prisma, apply, logger }) => {
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
      `${total} obra(s) a mover; ${kept} contrabaixo(s) de verdade; ${unknown} sem evidência (ficam)`,
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
      for (const part of chunks(ids)) {
        await prisma.work.updateMany({
          where: { id: { in: part } },
          data: { instrumentId: to },
        });
      }
    }
    logger.log(`Gravado: ${total} obra(s)`);
  },
);
