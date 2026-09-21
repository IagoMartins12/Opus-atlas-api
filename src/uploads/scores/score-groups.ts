/**
 * Grupos de partitura de uma obra e a sugestão de onde encaixar um envio novo
 * — o `work-scores/groups` do legado, que alimenta o `GroupingSuggestions` da
 * tela de envio.
 */

export interface ScoreGroupRow {
  groupIndex: number | null;
  groupTitle: string | null;
  uploadedBy: string | null;
  source: string;
}

export interface ScoreGroup {
  groupIndex: number;
  groupTitle: string;
  count: number;
  source: 'IMSLP' | 'USER_UPLOADED';
}

export interface GroupSuggestion {
  suggestedTitle: string;
  suggestedIndex: number;
  reason: string;
  confidence: 'high' | 'medium';
  source: 'USER_UPLOADED';
}

const has = (groups: ScoreGroup[], words: string[]) =>
  groups.some((group) =>
    words.some((word) => group.groupTitle.toLowerCase().includes(word)),
  );

function groupsOf(rows: ScoreGroupRow[], source: ScoreGroup['source']) {
  const map = new Map<string, ScoreGroup>();

  for (const row of rows) {
    const groupIndex = row.groupIndex ?? 0;
    const groupTitle = row.groupTitle || 'Sem Grupo';
    const key = `${groupIndex}-${groupTitle}`;
    const group = map.get(key) ?? { groupIndex, groupTitle, count: 0, source };
    group.count++;
    map.set(key, group);
  }

  return [...map.values()].sort((a, b) => a.groupIndex - b.groupIndex);
}

export function scoreGroupsFor(rows: ScoreGroupRow[], userId: string) {
  const imslp = rows.filter((row) => row.source === 'IMSLP');
  const mine = rows.filter(
    (row) => row.source !== 'IMSLP' && row.uploadedBy === userId,
  );
  const others = rows.filter(
    (row) => row.source !== 'IMSLP' && row.uploadedBy !== userId,
  );

  const groups = groupsOf(imslp, 'IMSLP');
  const userGroups = groupsOf(mine, 'USER_UPLOADED');
  const visible = [...groups, ...userGroups];
  const nextIndex =
    Math.max(...visible.map((group) => group.groupIndex), 0) + 1;

  const hasComplete = has(visible, ['complete', 'completa', 'full']);
  const hasParts = has(visible, ['individual', 'separate', 'parts', 'partes']);
  const hasArrangements = has(visible, ['arrangement', 'arranjo']);
  const suggestions: GroupSuggestion[] = [];

  if (hasComplete && !hasParts) {
    suggestions.push({
      suggestedTitle: 'Partes Individuais',
      suggestedIndex: nextIndex,
      reason:
        'Já existe uma partitura completa; esta pode ser uma parte individual',
      confidence: 'high',
      source: 'USER_UPLOADED',
    });
  }

  if (!hasComplete && hasParts) {
    suggestions.push({
      suggestedTitle: 'Partitura Completa',
      suggestedIndex: 0,
      reason: 'Existem partes individuais; esta pode ser a partitura completa',
      confidence: 'high',
      source: 'USER_UPLOADED',
    });
  }

  if (!hasArrangements && visible.length > 0) {
    suggestions.push({
      suggestedTitle: 'Arranjos',
      suggestedIndex: nextIndex,
      reason: 'Criar uma seção nova para arranjos',
      confidence: 'medium',
      source: 'USER_UPLOADED',
    });
  }

  if (userGroups.length === 0) {
    suggestions.push({
      suggestedTitle: 'Partitura Completa',
      suggestedIndex: 0,
      reason: 'Primeira partitura sua para esta obra',
      confidence: 'high',
      source: 'USER_UPLOADED',
    });
  }

  return {
    success: true,
    groups,
    userGroups,
    suggestions,
    hasExistingScores: rows.length > 0,
    stats: {
      totalGroups: groups.length + userGroups.length,
      imslpGroups: groups.length,
      userGroups: userGroups.length,
      otherUsersGroups: groupsOf(others, 'USER_UPLOADED').length,
      totalScores: rows.length,
      userScores: mine.length,
      imslpScores: imslp.length,
      otherUsersScores: others.length,
    },
  };
}
