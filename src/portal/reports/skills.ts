import { AssignmentType } from '@prisma/client';

/**
 * As habilidades que o relatório pedagógico acompanha (21/10/2026).
 *
 * **Lista fixa, de propósito.** O texto livre ("escalas", "Escalas maiores",
 * "escala") não soma consigo mesmo e não dá curva de evolução. A nota de cada
 * habilidade vem do fechamento da aula (`Lesson.skillRatings`, 1–5); o volume
 * vem das tarefas (pelo tipo) e da prática (pelo tema, lido por palavra-chave).
 */
export const SKILLS = [
  'technique',
  'reading',
  'rhythm',
  'interpretation',
  'memory',
  'theory',
  'ear',
  'sound',
] as const;

export type Skill = (typeof SKILLS)[number];

export const SKILL_LABEL: Record<Skill, string> = {
  technique: 'Técnica',
  reading: 'Leitura',
  rhythm: 'Ritmo',
  interpretation: 'Interpretação',
  memory: 'Memória',
  theory: 'Teoria',
  ear: 'Percepção',
  sound: 'Sonoridade',
};

export const isSkill = (value: string): value is Skill =>
  (SKILLS as readonly string[]).includes(value);

/** Tarefa → habilidade, quando o tipo diz. "Prática" é genérica: não conta. */
export const ASSIGNMENT_SKILL: Partial<Record<AssignmentType, Skill>> = {
  [AssignmentType.theory]: 'theory',
  [AssignmentType.composition]: 'theory',
  [AssignmentType.listening]: 'ear',
  [AssignmentType.performance]: 'interpretation',
};

/** Palavras que levam um texto livre (tema da prática, tópico) a uma habilidade. */
const KEYWORDS: Array<[Skill, RegExp]> = [
  [
    'technique',
    /t[eé]cnica|escala|arpejo|exerc[ií]cio|hanon|czerny|dedilhado|technique|scale|arpeggio/,
  ],
  ['reading', /leitura|primeira vista|sight|reading|solfejo/],
  ['rhythm', /ritmo|r[ií]tmic|metr[oô]nomo|pulso|rhythm|metronome/],
  [
    'interpretation',
    /interpreta|fraseado|din[aâ]mica|express|estilo|phrasing|dynamics|interpretation/,
  ],
  ['memory', /mem[oó]ria|de cor|decorar|memori/],
  ['theory', /teoria|harmonia|an[aá]lise|cifra|acorde|theory|harmony|analysis/],
  ['ear', /percep|ouvido|ditado|escuta|intervalo|ear training|listening/],
  ['sound', /sonoridade|timbre|toque|pedal|som\b|tone|sound/],
];

/** A habilidade que um texto livre menciona, ou `null`. */
export function skillOf(text: string | null | undefined): Skill | null {
  if (!text) return null;
  const value = text.toLowerCase();
  for (const [skill, pattern] of KEYWORDS) {
    if (pattern.test(value)) return skill;
  }
  return null;
}

/** Notas de 1 a 5 só das habilidades da lista; o resto é descartado. */
export function cleanRatings(raw: unknown): Partial<Record<Skill, number>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Partial<Record<Skill, number>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (
      isSkill(key) &&
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 5
    ) {
      out[key] = value;
    }
  }
  return out;
}
