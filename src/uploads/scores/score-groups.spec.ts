import { scoreGroupsFor } from './score-groups';

const row = (
  groupIndex: number,
  groupTitle: string,
  source = 'IMSLP',
  uploadedBy: string | null = null,
) => ({
  groupIndex,
  groupTitle,
  source,
  uploadedBy,
});

describe('scoreGroupsFor', () => {
  it('separa IMSLP, meus e de outros', () => {
    const result = scoreGroupsFor(
      [
        row(0, 'Complete', 'IMSLP'),
        row(0, 'Complete', 'IMSLP'),
        row(1, 'Minha edição', 'UPLOAD', 'u1'),
        row(1, 'Outra', 'UPLOAD', 'u2'),
      ],
      'u1',
    );

    expect(result.groups).toEqual([
      { groupIndex: 0, groupTitle: 'Complete', count: 2, source: 'IMSLP' },
    ]);
    expect(result.userGroups).toHaveLength(1);
    expect(result.stats).toMatchObject({ otherUsersScores: 1, imslpScores: 2 });
  });

  it('com partitura completa e sem partes, sugere partes no próximo índice', () => {
    const result = scoreGroupsFor([row(0, 'Complete Score')], 'u1');

    expect(result.suggestions[0]).toMatchObject({
      suggestedTitle: 'Partes Individuais',
      suggestedIndex: 1,
    });
  });

  it('obra sem nada: sugere a partitura completa', () => {
    const result = scoreGroupsFor([], 'u1');

    expect(result.hasExistingScores).toBe(false);
    expect(result.suggestions).toEqual([
      expect.objectContaining({
        suggestedTitle: 'Partitura Completa',
        suggestedIndex: 0,
      }),
    ]);
  });
});
