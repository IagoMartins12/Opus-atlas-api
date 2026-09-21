import {
  ArticleContentError,
  CONTENT_LIMITS,
  emptyDoc,
  sanitizeArticleContent,
} from './article-content.policy';

const doc = (...content: unknown[]) => ({ type: 'doc', content });
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const t = (text: string, marks?: unknown[]) => ({
  type: 'text',
  text,
  ...(marks ? { marks } : {}),
});
const linkTo = (href: string) =>
  doc(p(t('clique', [{ type: 'link', attrs: { href } }])));
const block = (type: string, attrs: Record<string, unknown>) =>
  doc({ type, attrs });

const refusal = (raw: unknown): ArticleContentError => {
  try {
    sanitizeArticleContent(raw);
  } catch (error) {
    if (error instanceof ArticleContentError) return error;
    throw error;
  }

  throw new Error('esperava que o conteúdo fosse recusado');
};

const cleaned = (raw: unknown) => sanitizeArticleContent(raw).doc;

describe('sanitizeArticleContent', () => {
  it('aceita o que o editor produz, sem mudar nada', () => {
    const raw = doc(
      {
        type: 'heading',
        attrs: { level: 2, textAlign: null },
        content: [t('Vida')],
      },
      p(t('Nasceu em ', [{ type: 'bold' }]), t('1810.')),
      {
        type: 'image',
        attrs: {
          src: '/uploads/blog/a.png',
          alt: 'Retrato',
          title: null,
          width: null,
          height: '300px',
        },
      },
    );

    expect(cleaned(raw)).toEqual(raw);
  });

  // Medido na base: quebra de linha dentro de trecho em negrito.
  it('mantém a marca de nó em linha que não é texto', () => {
    const raw = doc(
      p(t('a'), { type: 'hardBreak', marks: [{ type: 'bold' }] }),
    );

    expect(cleaned(raw)).toEqual(raw);
  });

  it('valida a marca de nó que não é texto', () => {
    expect(
      refusal(doc(p({ type: 'hardBreak', marks: [{ type: 'script' }] }))).path,
    ).toBe('content.content[0].content[0].marks[0].type');
  });

  it('sem conteúdo, devolve o documento vazio do editor', () => {
    expect(sanitizeArticleContent(undefined)).toEqual({
      doc: emptyDoc(),
      words: 0,
    });
  });

  // Tempo de leitura: só o texto corrido conta, não os atributos dos blocos.
  it('conta as palavras do texto corrido, e só dele', () => {
    const raw = doc(p(t('um dois três')), {
      type: 'quoteMusical',
      attrs: { quote: 'quatro cinco seis sete', author: 'x' },
    });

    expect(sanitizeArticleContent(raw).words).toBe(3);
  });

  it('o documento precisa começar por "doc"', () => {
    expect(refusal(p(t('solto'))).path).toBe('content.type');
  });

  describe('tipos fechados', () => {
    // Remover em silêncio faria parte do texto do autor sumir sem ele saber.
    it('recusa bloco desconhecido, apontando onde ele está', () => {
      const error = refusal(
        doc(p(t('a')), { type: 'iframe', attrs: { src: 'https://x' } }),
      );

      expect(error.path).toBe('content.content[1].type');
      expect(error.reason).toMatch(/desconhecido/);
    });

    it('recusa formatação desconhecida', () => {
      expect(refusal(doc(p(t('a', [{ type: 'script' }])))).path).toBe(
        'content.content[0].content[0].marks[0].type',
      );
    });

    // Atributo é metadado do editor, não texto de ninguém.
    it('descarta atributo desconhecido', () => {
      const out = cleaned(
        block('image', { src: '/a.png', onerror: 'alert(1)' }),
      );

      expect(out.content?.[0].attrs).toEqual({ src: '/a.png' });
    });

    // O leitor faz `createElement(\`h${level}\`)`: nível fora da lista derruba a página.
    it('recusa título de nível fora de 1 a 3', () => {
      expect(
        refusal(
          doc({ type: 'heading', attrs: { level: 7 }, content: [t('x')] }),
        ).path,
      ).toBe('content.content[0].attrs.level');
    });
  });

  describe('endereços', () => {
    // O leitor faz `a.href = mark.attrs.href`.
    it.each([
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'java\tscript:alert(1)',
      ' javascript:alert(1)',
      'vbscript:msgbox(1)',
      'data:text/html,<script>alert(1)</script>',
    ])('recusa link %j', (href) => {
      expect(refusal(linkTo(href)).reason).toMatch(/protocolo|endereço/);
    });

    it.each([
      [
        'https://www.pianotv.net/2017/01/bach/',
        'https://www.pianotv.net/2017/01/bach/',
      ],
      ['mailto:contato@opusatlas.com', 'mailto:contato@opusatlas.com'],
      ['/composer/123', '/composer/123'],
      ['#biografia', '#biografia'],
    ])('aceita link %j', (href, expected) => {
      const out = cleaned(linkTo(href));

      expect(out.content?.[0].content?.[0].marks?.[0].attrs?.href).toBe(
        expected,
      );
    });

    // `//host` é endereço de outro site com o protocolo da página.
    it.each(['//evil.example/x.png', '/\\evil.example/x.png'])(
      'recusa caminho que escapa do site: %j',
      (src) => {
        expect(refusal(block('image', { src })).path).toBe(
          'content.content[0].attrs.src',
        );
      },
    );

    it('recusa endereço com usuário e senha', () => {
      expect(
        refusal(block('image', { src: 'https://u:p@x.com/a.png' })).reason,
      ).toMatch(/usuário ou senha/);
    });

    it('recusa imagem embutida em data:', () => {
      expect(
        refusal(block('image', { src: 'data:image/png;base64,AAAA' })).reason,
      ).toMatch(/protocolo/);
    });

    // O leitor concatena `href="${scoreUrl}"`: a reserialização codifica a aspa.
    it('codifica aspas no endereço, para ele não fechar o atributo', () => {
      const out = cleaned(
        block('scoreViewer', {
          scoreUrl: 'https://x.com/a.pdf" onmouseover="alert(1)',
        }),
      );

      expect(out.content?.[0].attrs?.scoreUrl).toBe(
        'https://x.com/a.pdf%22%20onmouseover=%22alert(1)',
      );
    });

    // O leitor faz `iframe.src = node.attrs.src`.
    it('vídeo embutido só do YouTube, e por https', () => {
      expect(
        refusal(block('youtube', { src: 'https://evil.example/embed' })).reason,
      ).toMatch(/YouTube/);
      expect(
        refusal(block('youtube', { src: 'http://www.youtube.com/watch?v=x' }))
          .reason,
      ).toMatch(/YouTube/);
      expect(
        cleaned(
          block('youtube', { src: 'https://www.youtube.com/watch?v=abc' }),
        ).content?.[0].attrs?.src,
      ).toBe('https://www.youtube.com/watch?v=abc');
    });

    it('comparação de vídeos também só aceita YouTube', () => {
      expect(
        refusal(
          block('videoComparison', {
            video1: {
              url: 'https://evil.example/v',
              title: 'A',
              description: '',
            },
          }),
        ).path,
      ).toBe('content.content[0].attrs.video1.url');
    });
  });

  describe('texto de bloco que o leitor põe em innerHTML', () => {
    it.each([
      ['scoreViewer', 'scoreTitle'],
      ['audioPlayer', 'title'],
      ['timeline', 'composerName'],
      ['videoComparison', 'title'],
      ['quoteMusical', 'author'],
    ])('%s.%s não aceita marcação', (type, field) => {
      const error = refusal(
        block(type, { [field]: '<img src=x onerror=alert(1)>' }),
      );

      expect(error.path).toBe(`content.content[0].attrs.${field}`);
      expect(error.reason).toMatch(/innerHTML|HTML/);
    });

    it('aspas e & continuam aceitas em texto de elemento', () => {
      const out = cleaned(
        block('quoteMusical', {
          quote: 'A música é "o silêncio" & o som',
          author: 'Debussy',
        }),
      );

      expect(out.content?.[0].attrs?.quote).toBe(
        'A música é "o silêncio" & o som',
      );
    });

    // O leitor escreve `alt="${event.title}"`: ali a aspa fecha o atributo.
    it('título de evento da linha do tempo não aceita aspas', () => {
      const error = refusal(
        block('timeline', {
          events: [{ title: 'x" onerror="alert(1)', date: '1810' }],
        }),
      );

      expect(error.path).toBe('content.content[0].attrs.events[0].title');
    });

    it('descarta campo desconhecido dentro do evento', () => {
      const out = cleaned(
        block('timeline', {
          events: [{ title: 'Nasce', date: '1810', html: '<b>x</b>' }],
        }),
      );

      expect(out.content?.[0].attrs?.events).toEqual([
        { title: 'Nasce', date: '1810' },
      ]);
    });

    // O leitor monta `href="/composer/${composerId}"` por concatenação.
    it('id de compositor precisa ser ObjectId', () => {
      expect(
        refusal(block('composerCard', { composerId: '1" onclick="alert(1)' }))
          .path,
      ).toBe('content.content[0].attrs.composerId');
    });
  });

  // O leitor insere o texto com `createTextNode`, que não interpreta marcação.
  it('texto corrido aceita qualquer caractere', () => {
    const out = cleaned(doc(p(t('<script>alert(1)</script> é texto'))));

    expect(out.content?.[0].content?.[0].text).toBe(
      '<script>alert(1)</script> é texto',
    );
  });

  describe('limites', () => {
    it('recusa conteúdo acima do tamanho', () => {
      const huge = doc(p(t('x'.repeat(CONTENT_LIMITS.maxBytes))));

      expect(refusal(huge).path).toBe('content');
    });

    it('recusa aninhamento profundo demais', () => {
      let node: unknown = t('fundo');

      for (let level = 0; level <= CONTENT_LIMITS.maxDepth + 1; level += 1) {
        node = { type: 'blockquote', content: [node] };
      }

      expect(refusal(doc(node)).reason).toMatch(/aninhamento/);
    });

    it('recusa linha do tempo com eventos demais', () => {
      const events = Array.from(
        { length: CONTENT_LIMITS.maxTimelineEvents + 1 },
        () => ({
          title: 'x',
        }),
      );

      expect(refusal(block('timeline', { events })).reason).toMatch(/itens/);
    });
  });
});
