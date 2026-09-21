import * as cheerio from 'cheerio';
import {
  cleanComposerName,
  cleanComposerPermLink,
  cleanImslpUrl,
  cleanTitle,
  dataCompleteness,
  determinePrimaryInstrument,
  determineWorkType,
  extractCategories,
  extractImslpWorkId,
  extractSubtitle,
  extractWorkDetails,
  extractWorkGenres,
  permLinkVariations,
  stripComposerSuffix,
  UNDEFINED_GENRE,
} from './imslp-work.parser';

const page = (body: string) =>
  cheerio.load(`<html><body>${body}</body></html>`);

describe('cleanImslpUrl', () => {
  // Mantê-los faria a mesma obra entrar duas vezes, com permalinks diferentes.
  it('remove fragmento e query', () => {
    expect(
      cleanImslpUrl('https://imslp.org/wiki/Sonata_(Bach)?action=edit#Sheet'),
    ).toBe('https://imslp.org/wiki/Sonata_(Bach)');
  });

  it('decodifica escapes de URL', () => {
    expect(cleanImslpUrl('https://imslp.org/wiki/Faur%C3%A9')).toBe(
      'https://imslp.org/wiki/Fauré',
    );
  });

  // Sequência de escape inválida não pode custar a referência da obra.
  it('sobrevive a escape malformado', () => {
    expect(cleanImslpUrl('https://imslp.org/wiki/100%_Sonata#x')).toBe(
      'https://imslp.org/wiki/100%_Sonata',
    );
  });
});

describe('cleanComposerName', () => {
  it('normaliza aspas, travessões e espaços', () => {
    expect(cleanComposerName('  Gabriel   “Fauré”—Camille ')).toBe(
      'Gabriel "Fauré"-Camille',
    );
  });

  it('devolve vazio para nome ausente', () => {
    expect(cleanComposerName('')).toBe('');
  });
});

describe('cleanComposerPermLink', () => {
  it('garante o prefixo de categoria', () => {
    expect(cleanComposerPermLink('Bach,_Johann')).toBe('Category:Bach,_Johann');
  });

  it('não duplica o prefixo', () => {
    expect(cleanComposerPermLink('Category:Bach')).toBe('Category:Bach');
  });
});

describe('permLinkVariations', () => {
  // O IMSLP escreve `Fauré` e o catálogo pode ter `Faure`; sem a variação, a
  // obra entra sem compositor.
  it('inclui a versão sem acento', () => {
    expect(permLinkVariations('Category:Fauré')).toContain('Category:Faure');
  });

  // A página dá sublinhado; o catálogo guarda espaço. Medido no banco:
  // 19.173 das 19.174 fichas estão com espaço, e o legado só convertia espaço
  // **em** sublinhado — nunca o contrário.
  it('inclui a versão com espaço, que é a do catálogo', () => {
    expect(permLinkVariations('Category:Bach,_Johann_Sebastian')).toContain(
      'Category:Bach, Johann Sebastian',
    );
  });

  it('inclui a versão com sublinhado quando vem com espaço', () => {
    expect(permLinkVariations('Category:Bach, Johann Sebastian')).toContain(
      'Category:Bach,_Johann_Sebastian',
    );
  });

  // As duas diferenças se combinam.
  it('combina acento e sublinhado', () => {
    expect(permLinkVariations('Category:Fauré,_Gabriel')).toContain(
      'Category:Faure, Gabriel',
    );
  });

  it('não repete quando não há o que variar', () => {
    expect(permLinkVariations('Category:Bach')).toEqual(['Category:Bach']);
  });
});

describe('extractImslpWorkId', () => {
  it('tira o identificador do nome da página', () => {
    const $ = page('');

    expect(
      extractImslpWorkId($, 'https://imslp.org/wiki/Sonata_No.1').urlId,
    ).toBe('Sonata_No.1');
  });

  it('acha o id numérico na URL canônica', () => {
    const $ = cheerio.load(
      '<html><head><link rel="canonical" href="https://imslp.org/index.php?curid=98765"></head><body></body></html>',
    );

    expect(extractImslpWorkId($, 'https://imslp.org/wiki/X').pageId).toBe(
      '98765',
    );
  });

  it('cai para os atributos de dados quando não há canônica', () => {
    const $ = page('<div data-mw-pageid="4242"></div>');

    expect(extractImslpWorkId($, 'https://imslp.org/wiki/X').pageId).toBe(
      '4242',
    );
  });

  // O IMSLP não publica o id de forma consistente, por isso ele é opcional.
  it('devolve nulo quando a página não expõe o id', () => {
    expect(
      extractImslpWorkId(page(''), 'https://imslp.org/wiki/X').pageId,
    ).toBe(null);
  });
});

describe('extractWorkDetails', () => {
  const ficha = page(`
    <div class="wi_body"><table>
      <tr><th>Opus/Catalogue Number</th><td>Op. 27</td></tr>
      <tr><th>Composition Year</th><td>1801</td></tr>
      <tr><th>Key</th><td>C-sharp minor</td></tr>
      <tr><th>Instrumentation</th><td>piano</td></tr>
      <tr><th>Dedication</th><td>Giulietta</td></tr>
      <tr><th>Movements/Sections</th><td>3</td></tr>
      <tr><th>Nada</th><td>-</td></tr>
    </table></div>`);

  it('lê a ficha técnica linha a linha', () => {
    const details = extractWorkDetails(ficha);

    expect(details).toMatchObject({
      opOrCatalog: 'Op. 27',
      compositionYear: '1801',
      tone: 'C-sharp minor',
      instrumentation: 'piano',
      dedicateTo: 'Giulietta',
      moviment: '3',
    });
  });

  it('descarta célula vazia ou com traço', () => {
    expect(extractWorkDetails(ficha)).not.toHaveProperty('nada');
  });
});

describe('extractSubtitle', () => {
  it('prefere o título alternativo da ficha', () => {
    const $ = page(`
      <div class="wp_header"><table>
        <tr><th>Alternative Title</th><td>Mondscheinsonate</td></tr>
      </table></div>`);

    expect(extractSubtitle('Sonata (Luar)', $)).toBe('Mondscheinsonate');
  });

  it('na falta dela, usa o que está entre parênteses', () => {
    expect(extractSubtitle('Sonata (Luar)', page(''))).toBe('Luar');
  });

  it('devolve nulo quando não há subtítulo', () => {
    expect(extractSubtitle('Sonata', page(''))).toBeNull();
  });
});

describe('extractCategories', () => {
  it('traduz o que está no vocabulário', () => {
    const $ = page('<a href="/wiki/Category:For_2_pianos">x</a>');

    expect(extractCategories($)).toEqual(['Para 2 pianos']);
  });

  // O que não está no vocabulário sai: é o filtro que impede a página de
  // despejar dezenas de categorias internas do IMSLP no catálogo.
  it('descarta categoria desconhecida', () => {
    const $ = page('<a href="/wiki/Category:Pages_with_commentary">x</a>');

    expect(extractCategories($)).toEqual([]);
  });

  it('não repete a mesma categoria', () => {
    const $ = page(
      '<a href="/wiki/Category:For_2_pianos">a</a><a href="/wiki/Category:For_2_pianos">b</a>',
    );

    expect(extractCategories($)).toHaveLength(1);
  });
});

describe('extractWorkGenres', () => {
  it('lê os gêneros dos links de categoria', () => {
    const $ = page('<a href="/wiki/Category:Sonatas">x</a>');

    expect(extractWorkGenres($)).not.toEqual([UNDEFINED_GENRE]);
  });

  // Lista vazia obrigaria o resto do sistema a adivinhar como interpretá-la.
  it('quando nada resolve, diz "não definido" explicitamente', () => {
    expect(extractWorkGenres(page(''))).toEqual([UNDEFINED_GENRE]);
  });

  it('ignora parâmetro de transclusão no link', () => {
    const $ = page('<a href="/wiki/Category:Sonatas&transclude=File:x">x</a>');

    expect(extractWorkGenres($)).not.toEqual([UNDEFINED_GENRE]);
  });
});

describe('determineWorkType', () => {
  it('reconhece arranjo', () => {
    expect(determineWorkType('Sonata (arr. for guitar)')).toBe('ARRANGEMENT');
  });

  it('reconhece obras completas', () => {
    expect(determineWorkType('Complete Works for Piano')).toBe(
      'COLLECTED_WORKS',
    );
  });

  it('reconhece peça individual pela numeração', () => {
    expect(determineWorkType('Prelude No. 4')).toBe('INDIVIDUAL');
  });

  it('exige o segundo termo para acusar colaboração', () => {
    expect(determineWorkType('Joint')).not.toBe('COLLABORATION');
    expect(determineWorkType('Fantasia, joint with Liszt')).toBe(
      'COLLABORATION',
    );
  });

  // É esta parte que a segunda cópia do legado não tinha: obras entravam como
  // INDIVIDUAL por uma rota e como COLLECTED_WORKS pela outra.
  describe('quando o título não decide, olha o corpo da página', () => {
    it('vários compositores citados viram coletânea', () => {
      const $ = page('<p>Composer: Bach</p><p>Composers: vários</p>');

      expect(determineWorkType('Fantasia', $)).toBe('COLLECTIONS_WITH');
    });

    it('menção a obras completas no corpo classifica como tal', () => {
      const $ = page('<p>This page lists the complete works.</p>');

      expect(determineWorkType('Fantasia', $)).toBe('COLLECTED_WORKS');
    });

    it('sem página, o mesmo título cai no padrão', () => {
      expect(determineWorkType('Fantasia')).toBe('INDIVIDUAL');
    });
  });
});

describe('determinePrimaryInstrument', () => {
  it('acha o instrumento na instrumentação', () => {
    expect(determinePrimaryInstrument('Sonata', 'piano')).toBeTruthy();
  });

  it('devolve nulo quando não reconhece nenhum', () => {
    expect(determinePrimaryInstrument('Peça', 'nada disso', [])).toBeNull();
  });
});

describe('dataCompleteness', () => {
  it('mede a proporção de campos preenchidos', () => {
    expect(dataCompleteness({ a: 'x', b: null, c: 'y', d: '' })).toBe(50);
  });

  // Lista vazia é campo não preenchido: uma obra sem nenhum gênero não está
  // 100% completa só porque o campo existe.
  it('lista vazia não conta como preenchida', () => {
    expect(dataCompleteness({ a: [], b: ['x'] })).toBe(50);
  });

  it('sem campos, zero', () => {
    expect(dataCompleteness({})).toBe(0);
  });
});

describe('cleanTitle', () => {
  it('colapsa espaços', () => {
    expect(cleanTitle('  Sonata   em   Dó  ')).toBe('Sonata em Dó');
  });
});

describe('stripComposerSuffix', () => {
  // Medido no IMSLP: `#firstHeading` da Sonata ao Luar traz
  // "Piano Sonata No.14, Op.27 No.2 (Beethoven, Ludwig van)", e as 207.890
  // obras já no catálogo estão gravadas sem esse sufixo.
  it('tira o compositor que o IMSLP acrescenta ao cabeçalho', () => {
    expect(
      stripComposerSuffix(
        'Piano Sonata No.14, Op.27 No.2 (Beethoven, Ludwig van)',
        'Beethoven, Ludwig van',
      ),
    ).toBe('Piano Sonata No.14, Op.27 No.2');
  });

  it('ignora acento e caixa na comparação', () => {
    expect(
      stripComposerSuffix('Pavane (Fauré, Gabriel)', 'faure, gabriel'),
    ).toBe('Pavane');
  });

  // O corte é conferido, não adivinhado: um título que legitimamente termina
  // entre parênteses sobrevive, e o subtítulo que sai dele também.
  it('não corta parênteses que não são o compositor', () => {
    expect(stripComposerSuffix('Sonata (Luar)', 'Beethoven, Ludwig van')).toBe(
      'Sonata (Luar)',
    );
  });

  it('corta só o último grupo', () => {
    expect(
      stripComposerSuffix(
        'Sonata (Luar) (Beethoven, Ludwig van)',
        'Beethoven, Ludwig van',
      ),
    ).toBe('Sonata (Luar)');
  });

  it('sem compositor lido da página, não mexe no título', () => {
    expect(stripComposerSuffix('Sonata (Alguém)', null)).toBe(
      'Sonata (Alguém)',
    );
  });

  it('título sem parênteses passa inteiro', () => {
    expect(stripComposerSuffix('Sonata', 'Beethoven, Ludwig van')).toBe(
      'Sonata',
    );
  });
});
