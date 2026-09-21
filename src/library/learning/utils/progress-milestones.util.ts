/**
 * Porta a lógica de cálculo de progresso de `Classical-Music/src/app/utils/progressMilestones.ts`
 * (só `key`/`weight` — ícones/labels/cores são puramente de UI e ficam no front).
 */
interface MilestoneWeight {
  key: string;
  weight: number;
}

const PIANO_MILESTONES: MilestoneWeight[] = [
  { key: 'learnedLeftHand', weight: 15 },
  { key: 'learnedRightHand', weight: 15 },
  { key: 'playedWithMetronome', weight: 20 },
  { key: 'memorized', weight: 15 },
  { key: 'playedAtTempo', weight: 20 },
  { key: 'masteredDynamics', weight: 10 },
  { key: 'performedForOthers', weight: 5 },
];

const VIOLIN_MILESTONES: MilestoneWeight[] = [
  { key: 'learnedBowing', weight: 20 },
  { key: 'learnedFingering', weight: 15 },
  { key: 'intonationCorrect', weight: 20 },
  { key: 'playedWithMetronome', weight: 15 },
  { key: 'memorized', weight: 10 },
  { key: 'playedAtTempo', weight: 15 },
  { key: 'performedForOthers', weight: 5 },
];

const CELLO_MILESTONES: MilestoneWeight[] = [
  { key: 'learnedBowing', weight: 20 },
  { key: 'learnedFingering', weight: 15 },
  { key: 'postureAndHolding', weight: 10 },
  { key: 'intonationCorrect', weight: 20 },
  { key: 'playedWithMetronome', weight: 15 },
  { key: 'memorized', weight: 10 },
  { key: 'playedAtTempo', weight: 5 },
  { key: 'performedForOthers', weight: 5 },
];

const GENERIC_MILESTONES: MilestoneWeight[] = [
  { key: 'learnedBasics', weight: 25 },
  { key: 'playedWithMetronome', weight: 20 },
  { key: 'memorized', weight: 15 },
  { key: 'playedAtTempo', weight: 20 },
  { key: 'masteredExpression', weight: 15 },
  { key: 'performedForOthers', weight: 5 },
];

const INSTRUMENT_MILESTONES_MAP: Record<string, MilestoneWeight[]> = {
  piano: PIANO_MILESTONES,
  violin: VIOLIN_MILESTONES,
  violino: VIOLIN_MILESTONES,
  cello: CELLO_MILESTONES,
  violoncelo: CELLO_MILESTONES,
  violoncello: CELLO_MILESTONES,
};

export function getMilestonesByInstrument(
  instrumentName?: string | null,
): MilestoneWeight[] {
  if (!instrumentName) return GENERIC_MILESTONES;

  const normalized = instrumentName.toLowerCase().trim();
  return INSTRUMENT_MILESTONES_MAP[normalized] ?? GENERIC_MILESTONES;
}

export function calculateProgress(
  milestones: Record<string, boolean>,
  availableMilestones: MilestoneWeight[],
): number {
  const totalWeight = availableMilestones
    .filter((milestone) => milestones[milestone.key])
    .reduce((sum, milestone) => sum + milestone.weight, 0);

  return Math.min(100, totalWeight);
}
