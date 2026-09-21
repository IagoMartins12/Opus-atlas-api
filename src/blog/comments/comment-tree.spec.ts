import { buildCommentTree, removalChain, rootOf } from './comment-tree';

const at = (minute: number) => new Date(2026, 0, 1, 12, minute);

const c = (
  id: string,
  parentId: string | null,
  minute: number,
  extra: { likeCount?: number; status?: string } = {},
) => ({
  id,
  parentId,
  createdAt: at(minute),
  likeCount: extra.likeCount ?? 0,
  status: extra.status ?? 'APPROVED',
});

describe('buildCommentTree', () => {
  const comments = [
    c('a', null, 1, { likeCount: 1 }),
    c('b', null, 2, { likeCount: 5 }),
    c('a2', 'a', 4),
    c('a1', 'a', 3),
    c('a1x', 'a1', 5),
  ];

  it('mais recentes primeiro', () => {
    expect(buildCommentTree(comments, 'newest').map((n) => n.id)).toEqual([
      'b',
      'a',
    ]);
  });

  it('mais antigos primeiro', () => {
    expect(buildCommentTree(comments, 'oldest').map((n) => n.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('mais curtidos primeiro', () => {
    expect(buildCommentTree(comments, 'mostLiked').map((n) => n.id)).toEqual([
      'b',
      'a',
    ]);
  });

  it('respostas em ordem cronológica, em qualquer nível', () => {
    const [, a] = buildCommentTree(comments, 'newest');

    expect(a.replies.map((n) => n.id)).toEqual(['a1', 'a2']);
    expect(a.replies[0].replies.map((n) => n.id)).toEqual(['a1x']);
  });

  // Promover as respostas as mostraria respondendo a nada.
  it('resposta de comentário escondido some junto com ele', () => {
    const tree = buildCommentTree(
      [
        ...comments.filter((x) => x.id !== 'a1'),
        c('a1', 'a', 3, { status: 'REJECTED' }),
      ],
      'oldest',
      (x) => x.status === 'APPROVED',
    );

    const a = tree.find((n) => n.id === 'a');
    expect(a?.replies.map((n) => n.id)).toEqual(['a2']);
    expect(JSON.stringify(tree)).not.toContain('a1x');
  });

  it('artigo sem comentários dá lista vazia', () => {
    expect(buildCommentTree([], 'newest')).toEqual([]);
  });
});

describe('removalChain', () => {
  const removed = new Date(2026, 0, 1);

  it('sem marcador acima, sai só o comentário', () => {
    expect(
      removalChain(
        [
          { id: 'a', parentId: null, deletedAt: null },
          { id: 'a1', parentId: 'a', deletedAt: null },
        ],
        'a1',
      ),
    ).toEqual(['a1']);
  });

  // Um marcador só existe enquanto houver resposta embaixo dele.
  it('a última resposta de um marcador leva o marcador junto, de baixo para cima', () => {
    expect(
      removalChain(
        [
          { id: 'a', parentId: null, deletedAt: removed },
          { id: 'a1', parentId: 'a', deletedAt: removed },
          { id: 'a1x', parentId: 'a1', deletedAt: null },
        ],
        'a1x',
      ),
    ).toEqual(['a1x', 'a1', 'a']);
  });

  it('marcador que ainda tem outra resposta fica', () => {
    expect(
      removalChain(
        [
          { id: 'a', parentId: null, deletedAt: removed },
          { id: 'a1', parentId: 'a', deletedAt: null },
          { id: 'a2', parentId: 'a', deletedAt: null },
        ],
        'a1',
      ),
    ).toEqual(['a1']);
  });
});

describe('rootOf', () => {
  const flat = [
    { id: 'a', parentId: null },
    { id: 'a1', parentId: 'a' },
    { id: 'a1x', parentId: 'a1' },
  ];

  it('sobe até o comentário de topo', () => {
    expect(rootOf(flat, 'a1x')).toBe('a');
  });

  it('o de topo é a própria raiz', () => {
    expect(rootOf(flat, 'a')).toBe('a');
  });

  it('não entra em laço com dado corrompido', () => {
    expect(
      rootOf(
        [
          { id: 'x', parentId: 'y' },
          { id: 'y', parentId: 'x' },
        ],
        'x',
      ),
    ).toBeDefined();
  });
});
