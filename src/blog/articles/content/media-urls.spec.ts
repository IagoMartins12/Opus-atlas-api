import { collectMediaUrls, dropMediaUrls, replaceMediaUrl } from './media-urls';

const doc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '/uploads/nao-e-arquivo.png' }],
    },
    {
      type: 'image',
      attrs: { src: '/uploads/blog/_temp/s1/content/a.png', alt: 'a' },
    },
    {
      type: 'audioPlayer',
      attrs: { audioUrl: 'https://res.cloudinary.com/x/a.mp3' },
    },
    {
      type: 'quoteMusical',
      attrs: { backgroundAudioUrl: '/uploads/blog/audio/b.mp3' },
    },
    { type: 'composerCard', attrs: { composerImage: '/uploads/c.jpg' } },
    {
      type: 'timeline',
      attrs: {
        events: [
          { title: '1810', image: '/uploads/blog/t.png' },
          { title: 'sem' },
        ],
      },
    },
    {
      type: 'blockquote',
      content: [
        {
          type: 'image',
          attrs: { src: '/uploads/blog/_temp/s1/content/a.png' },
        },
      ],
    },
  ],
};

describe('collectMediaUrls', () => {
  it('acha o arquivo de cada bloco, inclusive aninhado e na linha do tempo', () => {
    expect(collectMediaUrls(doc).sort()).toEqual(
      [
        '/uploads/blog/_temp/s1/content/a.png',
        'https://res.cloudinary.com/x/a.mp3',
        '/uploads/blog/audio/b.mp3',
        '/uploads/c.jpg',
        '/uploads/blog/t.png',
      ].sort(),
    );
  });

  // Texto corrido que parece caminho não é arquivo.
  it('ignora texto que só parece endereço', () => {
    expect(collectMediaUrls(doc)).not.toContain('/uploads/nao-e-arquivo.png');
  });

  it('conteúdo vazio não tem arquivo', () => {
    expect(collectMediaUrls(null)).toEqual([]);
  });
});

describe('replaceMediaUrl', () => {
  it('troca todas as ocorrências, sem mexer no original', () => {
    const { doc: replaced, replaced: count } = replaceMediaUrl(
      doc,
      '/uploads/blog/_temp/s1/content/a.png',
      'https://res.cloudinary.com/x/a.png',
    );

    expect(count).toBe(2);
    expect(collectMediaUrls(replaced)).toContain(
      'https://res.cloudinary.com/x/a.png',
    );
    expect(collectMediaUrls(doc)).toContain(
      '/uploads/blog/_temp/s1/content/a.png',
    );
  });

  it('não troca texto corrido', () => {
    const { replaced } = replaceMediaUrl(
      doc,
      '/uploads/nao-e-arquivo.png',
      'x',
    );

    expect(replaced).toBe(0);
  });
});

describe('dropMediaUrls', () => {
  const isLost = (url: string) => url.startsWith('/uploads/');

  it('imagem e player perdidos saem inteiros; o texto fica', () => {
    const { doc: result, dropped } = dropMediaUrls(doc, isLost);
    const types = (result as { content: { type: string }[] }).content.map(
      (node) => node.type,
    );

    expect(types).not.toContain('image');
    expect(types).toContain('paragraph');
    // O player aponta para o Cloudinary: não está perdido, fica.
    expect(types).toContain('audioPlayer');
    expect(dropped).toContain('/uploads/blog/_temp/s1/content/a.png');
  });

  it('nos outros blocos, só o endereço vira null', () => {
    const { doc: result } = dropMediaUrls(doc, isLost);
    const nodes = (result as { content: Record<string, unknown>[] }).content;
    const card = nodes.find((node) => node.type === 'composerCard') as {
      attrs: Record<string, unknown>;
    };
    const timeline = nodes.find((node) => node.type === 'timeline') as {
      attrs: { events: Record<string, unknown>[] };
    };

    expect(card.attrs.composerImage).toBeNull();
    expect(timeline.attrs.events[0]).toEqual({ title: '1810', image: null });
  });

  it('não altera o original', () => {
    const before = JSON.stringify(doc);
    dropMediaUrls(doc, isLost);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('imagem dentro de outro bloco também sai', () => {
    const nested = {
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            { type: 'image', attrs: { src: '/uploads/x.png' } },
            { type: 'paragraph' },
          ],
        },
      ],
    };

    const { doc: result } = dropMediaUrls(nested, isLost);

    expect(result).toEqual({
      type: 'doc',
      content: [{ type: 'blockquote', content: [{ type: 'paragraph' }] }],
    });
  });
});
