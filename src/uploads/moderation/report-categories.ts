/**
 * Categorias de denúncia, com a prioridade e a gravidade de cada uma.
 *
 * **A categoria é fechada; o motivo continua texto livre.** O legado tinha só
 * `reason` como texto — e um texto livre não dá para priorizar, não dá para
 * medir prazo e não dá para decidir nada automaticamente. A categoria é o que
 * torna a regra de moderação (RN-4) aplicável; `reason` continua existindo para
 * quem denuncia contar o que viu.
 */
export const REPORT_CATEGORIES = {
  copyright: {
    label: 'Violação de direito autoral',
    priority: 'urgent',
    grave: true,
  },
  illegal: {
    label: 'Conteúdo ilegal',
    priority: 'urgent',
    grave: true,
  },
  offensive: {
    label: 'Conteúdo ofensivo',
    priority: 'high',
    grave: false,
  },
  spam: {
    label: 'Spam ou propaganda',
    priority: 'high',
    grave: false,
  },
  wrong_data: {
    label: 'Dado incorreto',
    priority: 'normal',
    grave: false,
  },
  duplicate: {
    label: 'Item duplicado',
    priority: 'low',
    grave: false,
  },
  other: {
    label: 'Outro',
    priority: 'normal',
    grave: false,
  },
} as const;

export const REPORT_CATEGORY_IDS = Object.keys(
  REPORT_CATEGORIES,
) as ReportCategory[];

export type ReportCategory = keyof typeof REPORT_CATEGORIES;
export type ReportPriority =
  (typeof REPORT_CATEGORIES)[ReportCategory]['priority'];

export function isReportCategory(value: string): value is ReportCategory {
  return value in REPORT_CATEGORIES;
}

/** A prioridade que a categoria determina. Quem denuncia não a escolhe. */
export function priorityOf(category: ReportCategory): ReportPriority {
  return REPORT_CATEGORIES[category].priority;
}

/**
 * A denúncia exige providência imediata?
 *
 * **Grave é só direito autoral e conteúdo ilegal**, e a lista é curta de
 * propósito: cada categoria grave é um botão que qualquer usuário autenticado
 * aperta sozinho. Ofensivo e spam ficam de fora justamente por serem
 * julgamento — o prazo de três dias os cobre.
 */
export function isGrave(category: ReportCategory): boolean {
  return REPORT_CATEGORIES[category].grave;
}
