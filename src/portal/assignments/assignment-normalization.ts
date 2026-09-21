/**
 * Normalização de `type` e `priority` das tarefas.
 *
 * Mapeia maiúsculas, espaços, acentos, sinônimos em português e os valores que
 * o front antigo conhece. O que não tiver correspondência vai para o padrão
 * (`practice`, `medium`) com `matched: false`, para quem normaliza avisar em
 * vez de trocar em silêncio. Usada pelo script `portal:normalize-assignments`,
 * que precisa rodar antes da versão com enum em toda base com tarefas.
 */

export const ASSIGNMENT_NORMALIZATION = {
  type: {
    fallback: 'practice',
    values: ['practice', 'theory', 'listening', 'composition', 'performance'],
    synonyms: {
      pratica: 'practice',
      estudo: 'practice',
      tecnica: 'practice',
      technique: 'practice',
      teoria: 'theory',
      escuta: 'listening',
      audicao: 'listening',
      apreciacao: 'listening',
      composicao: 'composition',
      apresentacao: 'performance',
      recital: 'performance',
    } as Record<string, string>,
  },
  priority: {
    fallback: 'medium',
    values: ['low', 'medium', 'high'],
    synonyms: {
      baixa: 'low',
      media: 'medium',
      normal: 'medium',
      alta: 'high',
      urgente: 'high',
      urgent: 'high',
    } as Record<string, string>,
  },
} as const;

export type NormalizedField = keyof typeof ASSIGNMENT_NORMALIZATION;

/** `"  Prática "` → `"pratica"`. */
function simplify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

export function normalizeValue(
  field: NormalizedField,
  raw: unknown,
): { value: string; matched: boolean } {
  const spec = ASSIGNMENT_NORMALIZATION[field];

  if (typeof raw === 'string') {
    const simple = simplify(raw);

    if ((spec.values as readonly string[]).includes(simple)) {
      return { value: simple, matched: true };
    }

    if (spec.synonyms[simple]) {
      return { value: spec.synonyms[simple], matched: true };
    }
  }

  return { value: spec.fallback, matched: false };
}
