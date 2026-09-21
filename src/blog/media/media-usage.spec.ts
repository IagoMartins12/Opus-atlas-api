import { buildUsage, formatBytes } from './media-usage';

const article = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Artigo ${id}`,
  slug: `artigo-${id}`,
  coverImage: null,
  backgroundMusicUrl: null,
  content: { type: 'doc', content: [] },
  ...overrides,
});

describe('buildUsage', () => {
  it('registra capa, música, conteúdo, categoria e galeria', () => {
    const usage = buildUsage({
      articles: [
        article('a', {
          coverImage: '/capa.png',
          backgroundMusicUrl: '/musica.mp3',
          content: {
            type: 'doc',
            content: [{ type: 'image', attrs: { src: '/img.png' } }],
          },
        }),
      ],
      categories: [
        {
          id: 'c',
          name: 'Romântico',
          slug: 'romantico',
          image: '/cat.png',
          coverImage: null,
        },
      ],
      media: [
        {
          url: '/galeria.png',
          thumbnailUrl: null,
          article: { id: 'a', title: 'Artigo a', slug: 'artigo-a' },
        },
      ],
    });

    expect(usage.get('/capa.png')?.[0].usageType).toBe('cover');
    expect(usage.get('/musica.mp3')?.[0].usageType).toBe('background-music');
    expect(usage.get('/img.png')?.[0].usageType).toBe('content');
    expect(usage.get('/cat.png')?.[0]).toMatchObject({
      owner: 'category',
      usageType: 'category',
    });
    expect(usage.get('/galeria.png')?.[0].usageType).toBe('gallery');
  });

  // O legado ignorava rascunho, e apagar o arquivo "não usado" o quebrava.
  it('rascunho conta como uso', () => {
    const usage = buildUsage({
      articles: [article('rascunho', { coverImage: '/so-no-rascunho.png' })],
      categories: [],
      media: [],
    });

    expect(usage.has('/so-no-rascunho.png')).toBe(true);
  });

  it('o mesmo arquivo em dois artigos aparece duas vezes, sem repetir dentro de um', () => {
    const content = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: '/x.png' } },
        { type: 'image', attrs: { src: '/x.png' } },
      ],
    };

    const usage = buildUsage({
      articles: [article('a', { content }), article('b', { content })],
      categories: [],
      media: [],
    });

    expect(usage.get('/x.png')?.map((item) => item.id)).toEqual(['a', 'b']);
  });
});

describe('formatBytes', () => {
  it('formata', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2.00 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB');
  });
});
