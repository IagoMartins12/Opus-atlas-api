import {
  calculateProgress,
  getMilestonesByInstrument,
} from './progress-milestones.util';

describe('progress-milestones.util', () => {
  it('usa GENERIC_MILESTONES quando o instrumento é desconhecido/ausente', () => {
    const milestones = getMilestonesByInstrument(undefined);
    expect(milestones.map((m) => m.key)).toContain('learnedBasics');
  });

  it('resolve variações em português (violino/violoncelo)', () => {
    expect(getMilestonesByInstrument('Violino')[0].key).toBe('learnedBowing');
    expect(getMilestonesByInstrument('violoncelo')[0].key).toBe(
      'learnedBowing',
    );
  });

  it('calcula o progresso somando os pesos dos milestones concluídos', () => {
    const milestones = getMilestonesByInstrument('piano');
    const progress = calculateProgress(
      { learnedLeftHand: true, learnedRightHand: true, memorized: false },
      milestones,
    );
    expect(progress).toBe(30);
  });

  it('nunca ultrapassa 100', () => {
    const milestones = getMilestonesByInstrument('piano');
    const allTrue = Object.fromEntries(milestones.map((m) => [m.key, true]));
    expect(calculateProgress(allTrue, milestones)).toBe(100);
  });
});
