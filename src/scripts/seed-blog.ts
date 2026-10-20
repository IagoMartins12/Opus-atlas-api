/**
 * Semeia o blog no banco LOCAL com uma massa parecida com a de produção:
 * três autores, categorias e tags novas, 16 artigos publicados ao longo de
 * dois meses (com capa, compositores e obras reais do catálogo, visitas,
 * curtidas e comentários), e destaques da agenda nos próximos meses.
 *
 * **Só roda contra `localhost`.** Recusa qualquer outro `DATABASE_URL`.
 *
 * **Idempotente.** Tudo o que cria é marcado pelos autores de semente
 * (e-mail `@seed.opusatlas.local`): rodar de novo apaga os artigos deles e
 * recria. Categorias e tags são atualizadas pelo slug; as que já existiam
 * antes (Barroco, Clássico, Romântico) só são usadas, nunca alteradas.
 *
 * Uso: `npm run build && node --env-file=.env.local dist/scripts/seed-blog.js`
 */
import { escapeRegex } from '../common/utils/regex.util';
import { PrismaClient, Prisma } from '@prisma/client';

const DOMINIO = '@seed.opusatlas.local';
const DIA = 86_400_000;

/** Ids no catálogo do banco local (conferidos em 01/10/2026). */
const COMPOSITORES: Record<string, string> = {
  'Ludwig van Beethoven': '685d9bd98803000f9b61d369',
  'Heitor Villa-Lobos': '685f89c1c6bd886c5b4995bc',
  'Frédéric Chopin': '685e1087c6bd886c5b495d66',
  'Wolfgang Amadeus Mozart': '685ef349c6bd886c5b497f8f',
  'Claude Debussy': '685e2b6fc6bd886c5b49611d',
  'Carlos Gomes': '685e6976c6bd886c5b496acc',
  'Clara Schumann': '685f4b9dc6bd886c5b498cee',
  'Antonio Vivaldi': '685f8b71c6bd886c5b4995fe',
  'Gustav Mahler': '685ed386c6bd886c5b497af9',
  'Pyotr Tchaikovsky': '685f72bec6bd886c5b49928b',
  'Johann Sebastian Bach': '685d8f9a8803000f9b61d151',
  'Chiquinha Gonzaga': '685e69d1c6bd886c5b496adb',
  'Maurice Ravel': '685f248cc6bd886c5b498739',
  'Giuseppe Verdi': '685f8721c6bd886c5b49955c',
  'Igor Stravinsky': '685f6a0bc6bd886c5b499135',
  'Franz Schubert': '685f4a93c6bd886c5b498cce',
};

type No = Record<string, unknown>;
const texto = (t: string, marcas?: string[]): No =>
  marcas
    ? { type: 'text', text: t, marks: marcas.map((type) => ({ type })) }
    : { type: 'text', text: t };
const p = (...partes: Array<string | No>): No => ({
  type: 'paragraph',
  content: partes.map((x) => (typeof x === 'string' ? texto(x) : x)),
});
const h2 = (t: string): No => ({
  type: 'heading',
  attrs: { level: 2 },
  content: [texto(t)],
});
const citacao = (t: string): No => ({ type: 'blockquote', content: [p(t)] });
const lista = (itens: string[]): No => ({
  type: 'bulletList',
  content: itens.map((i) => ({ type: 'listItem', content: [p(i)] })),
});
const doc = (...blocos: No[]) => ({ type: 'doc', content: blocos });
const em = (t: string) => texto(t, ['italic']);
const forte = (t: string) => texto(t, ['bold']);

/** O retrato original do IMSLP a partir da miniatura de 180px gravada no catálogo. */
function original(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(
    /^(https:\/\/imslp\.org\/images)\/thumb\/(.+?)\/\d+px-[^/]+$/,
  );
  return m ? `${m[1]}/${m[2]}` : url;
}

interface Autor {
  chave: string;
  firstName: string;
  lastName: string;
  username: string;
  bio: string | null;
}

const AUTORES: Autor[] = [
  {
    chave: 'helena',
    firstName: 'Helena',
    lastName: 'Prado',
    username: 'helena-prado',
    bio: 'Pianista e musicóloga. Escreve sobre repertório romântico e sobre como ouvir uma obra pela primeira vez sem se perder nela.',
  },
  {
    chave: 'rafael',
    firstName: 'Rafael',
    lastName: 'Teixeira',
    username: 'rafael-teixeira',
    bio: 'Jornalista cultural, acompanha a temporada de concertos no Rio e em São Paulo e a música brasileira de concerto.',
  },
  // Sem bio: a página do autor mostra o texto de reserva.
  {
    chave: 'marina',
    firstName: 'Marina',
    lastName: 'Lobo',
    username: 'marina-lobo',
    bio: null,
  },
];

const CATEGORIAS = [
  {
    slug: 'seculo-xx',
    name: 'Século XX',
    en: 'Twentieth century',
    order: 4,
    more: false,
    description:
      'Do impressionismo ao pós-guerra: a música que quebrou as regras.',
  },
  {
    slug: 'musica-brasileira',
    name: 'Música brasileira',
    en: 'Brazilian music',
    order: 5,
    more: false,
    description: 'Compositores, obras e intérpretes do Brasil.',
  },
  {
    slug: 'opera',
    name: 'Ópera',
    en: 'Opera',
    order: 6,
    more: false,
    description: 'Enredos, árias e a história do teatro cantado.',
  },
  {
    slug: 'guias-de-escuta',
    name: 'Guias de escuta',
    en: 'Listening guides',
    order: 7,
    more: true,
    description: 'Como ouvir uma obra, passo a passo.',
  },
  {
    slug: 'interpretes',
    name: 'Intérpretes',
    en: 'Performers',
    order: 8,
    more: true,
    description: 'Quem toca, rege e canta.',
  },
];

const TAGS = [
  ['sinfonia', 'symphony'],
  ['piano', 'piano'],
  ['concerto', 'concerto'],
  ['opera', 'opera'],
  ['primeira-escuta', 'first listen'],
  ['biografia', 'biography'],
  ['brasil', 'Brazil'],
  ['violino', 'violin'],
  ['orquestra', 'orchestra'],
  ['curiosidades', 'trivia'],
  ['historia', 'history'],
  ['impressionismo', 'impressionism'],
] as const;

interface Artigo {
  slug: string;
  titulo: string;
  resumo: string;
  autor: string;
  categorias: string[];
  tags: string[];
  compositor: string;
  /** Trechos do título das obras citadas (a primeira do compositor que bater). */
  obras?: string[];
  dias: number; // publicado há N dias
  visitas: number;
  destaque?: number;
  corpo: No;
  en?: { titulo: string; resumo: string; corpo: No };
}

const ARTIGOS: Artigo[] = [
  {
    slug: 'a-nona-de-beethoven-duzentos-anos-depois',
    titulo: 'A Nona de Beethoven, duzentos anos depois',
    resumo:
      'Como uma sinfonia com coro, estreada em Viena em 1824, virou o hino de quase tudo — e o que ainda vale ouvir nela.',
    autor: 'helena',
    categorias: ['classico', 'guias-de-escuta'],
    tags: ['sinfonia', 'primeira-escuta', 'orquestra'],
    compositor: 'Ludwig van Beethoven',
    obras: ['Symphony No.9, Op.125'],
    dias: 2,
    visitas: 4820,
    destaque: 1,
    corpo: doc(
      p(
        'Em 7 de maio de 1824, no Theater am Kärntnertor, em Viena, Beethoven subiu ao palco para a estreia da sua ',
        forte('Nona Sinfonia'),
        '. Já estava praticamente surdo. Conta-se que, ao fim, uma das solistas o virou para a plateia para que ele visse os aplausos que não podia ouvir.',
      ),
      h2('Uma sinfonia que canta'),
      p(
        'A novidade era o coro. Pela primeira vez uma sinfonia de grande porte terminava com vozes, cantando a ',
        em('Ode à Alegria'),
        ' de Friedrich Schiller. Beethoven guardava esse poema havia décadas.',
      ),
      p(
        'O último movimento começa quase em desordem: a orquestra cita os temas dos movimentos anteriores e os recusa, um a um, até que os contrabaixos apresentam, sozinhos, a melodia que todo mundo conhece.',
      ),
      h2('O que ouvir na primeira vez'),
      lista([
        'O início do primeiro movimento, que parece nascer do silêncio: quintas vazias, sem saber ainda o tom.',
        'O scherzo, com os tímpanos tratados quase como solistas.',
        'O adagio, a página mais calma de toda a sinfonia.',
        'A entrada do barítono: "Ó amigos, não esses sons!"',
      ]),
      citacao(
        'Alle Menschen werden Brüder — todos os homens se tornam irmãos.',
      ),
      p(
        'Duzentos anos depois, a melodia virou hino da União Europeia e trilha de quase todo fim de ano. Vale ouvir a obra inteira, de uma vez, ao menos uma vez.',
      ),
    ),
    en: {
      titulo: "Beethoven's Ninth, two hundred years later",
      resumo:
        'How a choral symphony premiered in Vienna in 1824 became the anthem of almost everything — and what is still worth hearing in it.',
      corpo: doc(
        p(
          'On 7 May 1824, at the Theater am Kärntnertor in Vienna, Beethoven took the stage for the premiere of his ',
          forte('Ninth Symphony'),
          '. He was by then almost completely deaf. It is said that, at the end, one of the soloists turned him towards the audience so he could see the applause he could not hear.',
        ),
        h2('A symphony that sings'),
        p(
          "The novelty was the choir. For the first time a large-scale symphony ended with voices, singing Friedrich Schiller's ",
          em('Ode to Joy'),
          '. Beethoven had kept that poem with him for decades.',
        ),
        p(
          'The last movement opens almost in disorder: the orchestra quotes the themes of the previous movements and rejects them one by one, until the double basses, alone, present the melody everyone knows.',
        ),
        h2('What to listen for the first time'),
        lista([
          'The opening of the first movement, which seems to grow out of silence: bare fifths, not yet knowing the key.',
          'The scherzo, with the timpani treated almost as soloists.',
          'The adagio, the calmest page of the whole symphony.',
          'The baritone entry: "O friends, not these sounds!"',
        ]),
        citacao('Alle Menschen werden Brüder — all men become brothers.'),
        p(
          'Two hundred years later, the melody is the anthem of the European Union and the soundtrack of almost every New Year. It is worth hearing the whole work, in one sitting, at least once.',
        ),
      ),
    },
  },
  {
    slug: 'villa-lobos-e-as-bachianas-brasileiras',
    titulo: 'Villa-Lobos e as Bachianas Brasileiras',
    resumo:
      'Nove suítes que juntam o contraponto de Bach e o Brasil das modinhas, dos violeiros e do sertão.',
    autor: 'rafael',
    categorias: ['musica-brasileira', 'seculo-xx'],
    tags: ['brasil', 'biografia', 'historia'],
    compositor: 'Heitor Villa-Lobos',
    obras: ['Bachianas Brasileiras No.5', 'Bachianas Brasileiras No.2'],
    dias: 4,
    visitas: 3610,
    destaque: 2,
    corpo: doc(
      p(
        'Entre 1930 e 1945, Heitor Villa-Lobos escreveu nove ',
        forte('Bachianas Brasileiras'),
        ', para formações que vão do piano solo à orquestra, passando por oito violoncelos e soprano. A ideia era ousada: tratar a música popular brasileira com a disciplina contrapontística de Johann Sebastian Bach.',
      ),
      h2('Bach no sertão'),
      p(
        'Cada movimento leva dois títulos, um "barroco" e um brasileiro: Ária (Cantilena), Tocata (O trenzinho do caipira), Dança (Martelo). O segundo diz de onde vem a cor; o primeiro, a forma.',
      ),
      p(
        'A mais conhecida é a ',
        em('nº 5'),
        ', para soprano e conjunto de violoncelos. A Ária, cantada primeiro em vocalise e depois com o texto de Ruth Valadares Corrêa, é das páginas mais gravadas da música brasileira.',
      ),
      h2('O trenzinho'),
      p(
        'Na ',
        em('nº 2'),
        ', a Tocata imita uma locomotiva do interior subindo a serra: a orquestra arranca, ganha velocidade, apita e chega. É uma ótima porta de entrada para quem nunca ouviu Villa-Lobos.',
      ),
    ),
  },
  {
    slug: 'chopin-e-os-noturnos',
    titulo: 'Chopin e os noturnos: o piano que canta',
    resumo:
      'Por que 21 peças curtas para piano mudaram o que se esperava do instrumento no século XIX.',
    autor: 'helena',
    categorias: ['romantico'],
    tags: ['piano', 'primeira-escuta'],
    compositor: 'Frédéric Chopin',
    obras: ['Op.9'],
    dias: 6,
    visitas: 2980,
    destaque: 3,
    corpo: doc(
      p(
        'O noturno não foi invenção de Chopin: o irlandês John Field já escrevia peças com esse nome. Mas foi Chopin quem fez dele um gênero inteiro, com ',
        forte('21 noturnos'),
        ' compostos ao longo da vida.',
      ),
      h2('A ópera dentro do piano'),
      p(
        'Chopin adorava o bel canto italiano, de Bellini sobretudo. Nos noturnos, a mão direita canta como uma voz, com ornamentos que imitam o canto, enquanto a esquerda sustenta tudo com arpejos largos.',
      ),
      p(
        'O mais tocado é o ',
        em('Noturno em mi bemol maior, Op. 9 nº 2'),
        '. Curto, quase simples, e por isso mesmo difícil: qualquer exagero no rubato desmancha a melodia.',
      ),
      h2('Por onde começar'),
      lista([
        'Op. 9 nº 2, em mi bemol maior',
        'Op. 27 nº 2, em ré bemol maior',
        'Op. 48 nº 1, em dó menor — o mais dramático',
      ]),
    ),
  },
  {
    slug: 'o-que-e-uma-sinfonia',
    titulo: 'O que é uma sinfonia, afinal?',
    resumo:
      'Da abertura de ópera italiana às obras de uma hora e meia de Mahler: um guia curto para quem está começando.',
    autor: 'marina',
    categorias: ['guias-de-escuta', 'classico'],
    tags: ['sinfonia', 'orquestra', 'primeira-escuta'],
    compositor: 'Wolfgang Amadeus Mozart',
    obras: ['Symphony No.41'],
    dias: 9,
    visitas: 2410,
    corpo: doc(
      p(
        'A palavra vem do grego e quer dizer "soar junto". No começo do século XVIII, ',
        em('sinfonia'),
        ' era a peça instrumental que abria uma ópera. Aos poucos ela saiu do teatro e ganhou vida própria nas salas de concerto.',
      ),
      h2('Quatro movimentos, em geral'),
      lista([
        'Um movimento rápido, muitas vezes em forma-sonata.',
        'Um movimento lento, cantabile.',
        'Um minueto ou scherzo, de caráter de dança.',
        'Um final rápido.',
      ]),
      p(
        'Haydn escreveu mais de cem sinfonias e é chamado de "pai da sinfonia". Mozart levou a forma a um ponto altíssimo nas últimas três, de 1788 — a última, a ',
        forte('Júpiter'),
        ', termina com um final em que cinco temas se combinam ao mesmo tempo.',
      ),
      h2('E depois'),
      p(
        'Com Beethoven, a sinfonia ficou maior e mais pessoal. No fim do século XIX, Mahler dizia que uma sinfonia "deve ser como o mundo: abraçar tudo".',
      ),
    ),
  },
  {
    slug: 'debussy-e-o-mar',
    titulo: 'Debussy e o mar',
    resumo:
      'La Mer, de 1905, não descreve ondas: faz a orquestra se mover como elas.',
    autor: 'helena',
    categorias: ['seculo-xx'],
    tags: ['impressionismo', 'orquestra'],
    compositor: 'Claude Debussy',
    obras: ['La mer'],
    dias: 11,
    visitas: 1890,
    corpo: doc(
      p(
        'Debussy não gostava do rótulo de impressionista. Ainda assim, ',
        em('La Mer'),
        ', estreada em Paris em 1905, é a obra que mais se costuma associar à palavra. São três "esboços sinfônicos" sobre o mar.',
      ),
      h2('Cor em vez de tema'),
      p(
        'Em vez de grandes melodias desenvolvidas, Debussy trabalha com pequenos motivos que mudam de cor conforme passam de um instrumento a outro. A harmonia não "resolve" do jeito tradicional; ela flutua.',
      ),
      p(
        'Na primeira edição da partitura, ele pediu que a capa reproduzisse ',
        em('A grande onda de Kanagawa'),
        ', a gravura de Hokusai.',
      ),
    ),
  },
  {
    slug: 'carlos-gomes-e-o-guarani',
    titulo: 'Carlos Gomes e O Guarani no Scala',
    resumo:
      'Em 1870, um compositor de Campinas estreou uma ópera no maior teatro da Itália. A abertura virou vinheta de rádio.',
    autor: 'rafael',
    categorias: ['musica-brasileira', 'opera'],
    tags: ['opera', 'brasil', 'historia'],
    compositor: 'Carlos Gomes',
    obras: ['Guarany'],
    dias: 13,
    visitas: 1760,
    corpo: doc(
      p(
        'Antônio Carlos Gomes nasceu em Campinas em 1836 e foi estudar em Milão com bolsa do imperador D. Pedro II. Em 19 de março de 1870, o Teatro alla Scala estreou ',
        forte('Il Guarany'),
        ', baseada no romance de José de Alencar.',
      ),
      h2('Sucesso italiano'),
      p(
        'A ópera foi bem recebida e circulou pela Europa. Carlos Gomes tornou-se o compositor das Américas mais aplaudido nos teatros europeus do seu tempo.',
      ),
      p(
        'Para muitos brasileiros, a abertura é familiar por outro motivo: ela abre há décadas o programa de rádio ',
        em('A Voz do Brasil'),
        '.',
      ),
    ),
  },
  {
    slug: 'clara-schumann-pianista-e-compositora',
    titulo: 'Clara Schumann, pianista e compositora',
    resumo:
      'Uma das maiores pianistas do século XIX, ela também compôs — e por muito tempo quase ninguém tocou suas obras.',
    autor: 'marina',
    categorias: ['romantico', 'interpretes'],
    tags: ['piano', 'biografia'],
    compositor: 'Clara Schumann',
    obras: ['Piano Trio'],
    dias: 16,
    visitas: 1650,
    corpo: doc(
      p(
        'Clara Wieck foi menina-prodígio do piano, treinada pelo pai, Friedrich Wieck. Casou-se com Robert Schumann em 1840, contra a vontade dele, e fez uma carreira de concertista que durou mais de sessenta anos.',
      ),
      h2('A compositora'),
      p(
        'Clara escreveu um concerto para piano, canções, peças para piano e um ',
        forte('Trio com piano em sol menor'),
        ', de 1846, que hoje voltou ao repertório. Ela mesma duvidava do próprio talento como compositora, numa época que não esperava isso de uma mulher.',
      ),
      p(
        'Como intérprete, foi decisiva para a música de Robert e de Johannes Brahms, de quem foi amiga por toda a vida.',
      ),
    ),
  },
  {
    slug: 'as-quatro-estacoes-de-vivaldi',
    titulo: 'As Quatro Estações, com o soneto ao lado',
    resumo:
      'Vivaldi publicou cada concerto com um poema. Lido junto, a música vira quase um filme.',
    autor: 'helena',
    categorias: ['barroco', 'guias-de-escuta'],
    tags: ['violino', 'concerto', 'primeira-escuta'],
    compositor: 'Antonio Vivaldi',
    obras: ['Le quattro stagioni', 'Four Seasons'],
    dias: 19,
    visitas: 3120,
    corpo: doc(
      p(
        'Os quatro concertos para violino conhecidos como ',
        em('As Quatro Estações'),
        ' foram publicados em 1725, em Amsterdã, dentro de uma coleção maior chamada ',
        em("Il cimento dell'armonia e dell'inventione"),
        '.',
      ),
      h2('Música com legenda'),
      p(
        'Cada concerto vem acompanhado de um soneto, e Vivaldi marcou na partitura em que ponto cada verso acontece: os pássaros na primavera, o cão do pastor que late (na viola), a tempestade de verão, os caçadores do outono, o gelo do inverno.',
      ),
      p(
        'Ouvir com o poema ao lado é a melhor forma de perceber o quanto essa música é descritiva — e o quanto ela é bem construída mesmo sem o poema.',
      ),
    ),
  },
  {
    slug: 'mahler-e-a-segunda-sinfonia',
    titulo: 'Mahler e a Ressurreição',
    resumo:
      'A Segunda Sinfonia começa num funeral e termina com coro e órgão. Oitenta minutos para uma única pergunta.',
    autor: 'rafael',
    categorias: ['romantico'],
    tags: ['sinfonia', 'orquestra'],
    compositor: 'Gustav Mahler',
    obras: ['Symphony No.2'],
    dias: 23,
    visitas: 1320,
    corpo: doc(
      p(
        'Gustav Mahler levou seis anos para terminar a ',
        forte('Sinfonia nº 2'),
        ', estreada completa em Berlim em 1895. O primeiro movimento nasceu como um poema sinfônico chamado ',
        em('Totenfeier'),
        ', "rito fúnebre".',
      ),
      h2('Do luto ao coro'),
      p(
        'Os movimentos do meio são lembranças da vida; o quarto traz uma contralto cantando ',
        em('Urlicht'),
        ' ("Luz primordial"). O final, enorme, termina com coro, solistas, órgão e sinos.',
      ),
      p(
        'É uma obra para ouvir ao vivo ao menos uma vez: a orquestra inclui músicos tocando fora do palco, de longe.',
      ),
    ),
  },
  {
    slug: 'tchaikovsky-alem-do-quebra-nozes',
    titulo: 'Tchaikovsky além do Quebra-Nozes',
    resumo:
      'O compositor dos balés de Natal também escreveu uma das sinfonias mais sombrias do repertório.',
    autor: 'marina',
    categorias: ['romantico'],
    tags: ['sinfonia', 'biografia'],
    compositor: 'Pyotr Tchaikovsky',
    obras: ['Symphony No.6'],
    dias: 27,
    visitas: 1480,
    corpo: doc(
      p(
        'Para muita gente, Tchaikovsky é o compositor do ',
        em('Quebra-Nozes'),
        ', do ',
        em('Lago dos Cisnes'),
        ' e da ',
        em('Bela Adormecida'),
        '. Mas a obra que ele considerava a melhor que escreveu é a ',
        forte('Sinfonia nº 6, "Patética"'),
        '.',
      ),
      h2('Um final lento'),
      p(
        'Estreada em São Petersburgo em outubro de 1893, nove dias antes da morte do compositor, a sinfonia faz algo raro: termina com um movimento lento, que se apaga aos poucos.',
      ),
      p(
        'O terceiro movimento, uma marcha brilhante, costuma arrancar aplausos antes da hora. É parte da experiência.',
      ),
    ),
  },
  {
    slug: 'bach-e-as-variacoes-goldberg',
    titulo: 'Bach e as Variações Goldberg',
    resumo:
      'Uma ária, trinta variações e a ária de novo. A obra que Glenn Gould gravou duas vezes, em 1955 e em 1981.',
    autor: 'helena',
    categorias: ['barroco'],
    tags: ['piano', 'historia'],
    compositor: 'Johann Sebastian Bach',
    obras: ['Goldberg'],
    dias: 31,
    visitas: 2230,
    corpo: doc(
      p(
        'Publicadas em 1741, as ',
        forte('Variações Goldberg'),
        ' foram escritas para cravo de dois teclados. O nome vem de uma história contada pelo primeiro biógrafo de Bach: o cravista Johann Gottlieb Goldberg teria tocado as variações para um conde com insônia.',
      ),
      h2('A arquitetura'),
      p(
        'A cada três variações, uma é um cânone, e o intervalo entre as vozes aumenta um grau a cada vez: em uníssono, na segunda, na terceira, até a nona. A última variação é um ',
        em('quodlibet'),
        ', que mistura canções populares da época.',
      ),
      p(
        'Glenn Gould gravou a obra em 1955, num disco que mudou a forma de tocar Bach ao piano, e de novo em 1981, bem mais devagar. Vale comparar as duas.',
      ),
    ),
  },
  {
    slug: 'chiquinha-gonzaga-a-primeira-maestrina',
    titulo: 'Chiquinha Gonzaga, a primeira maestrina',
    resumo:
      'Compositora, pianista e regente, ela escreveu o Ó Abre Alas e enfrentou o Rio do século XIX.',
    autor: 'rafael',
    categorias: ['musica-brasileira'],
    tags: ['brasil', 'biografia', 'piano'],
    compositor: 'Chiquinha Gonzaga',
    obras: ['Corta'],
    dias: 35,
    visitas: 1980,
    corpo: doc(
      p(
        'Francisca Edwiges Neves Gonzaga nasceu no Rio de Janeiro em 1847. Separou-se do marido, sustentou-se dando aulas e tocando piano, e tornou-se a primeira mulher a reger uma orquestra no Brasil.',
      ),
      h2('Entre o salão e a rua'),
      p(
        'Escreveu polcas, tangos, valsas e operetas, misturando a música de salão europeia com ritmos que vinham das ruas do Rio. ',
        em('Ó Abre Alas'),
        ', de 1899, é considerada a primeira marchinha de carnaval.',
      ),
      p(
        'Seu ',
        em('Gaúcho'),
        ', conhecido como ',
        em('Corta-Jaca'),
        ', foi tocado no Palácio do Catete em 1914 e causou escândalo na política da época.',
      ),
    ),
  },
  {
    slug: 'ravel-e-o-bolero',
    titulo: 'O Bolero de Ravel: quinze minutos de crescendo',
    resumo:
      'Um tema, uma caixa que não para e uma orquestra que vai entrando aos poucos. Ravel chamava de "experiência".',
    autor: 'marina',
    categorias: ['seculo-xx', 'guias-de-escuta'],
    tags: ['orquestra', 'curiosidades'],
    compositor: 'Maurice Ravel',
    obras: ['Bol'],
    dias: 40,
    visitas: 2740,
    corpo: doc(
      p(
        'O ',
        forte('Bolero'),
        ' foi encomendado pela bailarina Ida Rubinstein e estreou em Paris em 1928. Ravel o descrevia como um exercício de orquestração: um único crescendo, sem desenvolvimento.',
      ),
      h2('Como funciona'),
      lista([
        'A caixa repete o mesmo ritmo do começo ao fim.',
        'Duas melodias se alternam, sempre iguais.',
        'O que muda é quem toca: flauta, clarinete, fagote, até a orquestra inteira.',
        'Só no fim a música muda de tom — e desaba.',
      ]),
      p(
        'Ravel ficou surpreso com o sucesso. "Escrevi apenas uma obra-prima", teria dito, "o Bolero. Infelizmente, ele não contém música."',
      ),
    ),
  },
  {
    slug: 'verdi-e-la-traviata',
    titulo: 'La Traviata para quem nunca foi à ópera',
    resumo:
      'Três atos, uma história de amor impossível e algumas das árias mais famosas do repertório.',
    autor: 'helena',
    categorias: ['opera', 'guias-de-escuta'],
    tags: ['opera', 'primeira-escuta'],
    compositor: 'Giuseppe Verdi',
    obras: ['Traviata'],
    dias: 45,
    visitas: 1570,
    corpo: doc(
      p(
        'Verdi estreou ',
        forte('La Traviata'),
        ' no Teatro La Fenice, em Veneza, em 1853. A história vem do romance ',
        em('A Dama das Camélias'),
        ', de Alexandre Dumas Filho, e era contemporânea: uma ópera sobre a sociedade do próprio tempo.',
      ),
      h2('Os momentos que você vai reconhecer'),
      lista([
        'O brinde do primeiro ato, "Libiamo ne\' lieti calici".',
        'A ária de Violetta "Sempre libera", que fecha o primeiro ato.',
        'O prelúdio do terceiro ato, com as cordas muito suaves.',
      ]),
      p(
        'A estreia foi um fracasso, e Verdi escreveu a um amigo que o tempo diria se a culpa era dele ou dos cantores. O tempo respondeu.',
      ),
    ),
  },
  {
    slug: 'stravinsky-e-a-sagracao',
    titulo: 'A noite em que a Sagração causou tumulto',
    resumo:
      'Paris, 29 de maio de 1913: a estreia de A Sagração da Primavera e a lenda do escândalo.',
    autor: 'rafael',
    categorias: ['seculo-xx'],
    tags: ['historia', 'orquestra', 'curiosidades'],
    compositor: 'Igor Stravinsky',
    obras: ['Sacre'],
    dias: 50,
    visitas: 2060,
    corpo: doc(
      p(
        'No Théâtre des Champs-Élysées, os Ballets Russes de Diaghilev estrearam ',
        forte('A Sagração da Primavera'),
        ', de Igor Stravinsky, com coreografia de Nijinsky. Parte do público reagiu com vaias e gritos já nos primeiros minutos.',
      ),
      h2('Por que tanto barulho'),
      p(
        'O fagote abre a obra num registro agudo que mal se reconhece. Depois vêm acordes repetidos com acentos irregulares, e uma dança final em que o compasso muda quase a cada momento.',
      ),
      p(
        'Um ano depois, tocada em concerto, sem a dança, a obra foi aplaudida. Hoje é uma das peças mais gravadas do século XX.',
      ),
    ),
  },
  {
    slug: 'schubert-e-o-ciclo-de-cancoes',
    titulo: 'Schubert e a viagem de inverno',
    resumo:
      'Vinte e quatro canções sobre um viajante solitário. Uma das obras mais desoladas e bonitas do romantismo.',
    autor: 'marina',
    categorias: ['romantico'],
    tags: ['biografia', 'piano'],
    compositor: 'Franz Schubert',
    obras: ['Winterreise'],
    dias: 56,
    visitas: 980,
    corpo: doc(
      p(
        'Franz Schubert escreveu mais de 600 canções. ',
        forte('Winterreise'),
        ' ("Viagem de inverno"), de 1827, sobre poemas de Wilhelm Müller, é a mais sombria das suas coleções.',
      ),
      h2('Piano e voz em pé de igualdade'),
      p(
        'O piano não acompanha apenas: ele desenha a neve, o vento, o realejo da última canção. Cantor e pianista contam a história juntos.',
      ),
      p(
        'Schubert morreu no ano seguinte, aos 31 anos. Seus amigos contavam que ele estava abatido quando lhes mostrou as canções pela primeira vez.',
      ),
    ),
  },
];

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  if (!/^mongodb(\+srv)?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
    throw new Error(
      `Recusado: a semeadura só roda no banco local (DATABASE_URL=${url.replace(/\/\/[^@]*@/, '//***@')})`,
    );
  }

  const prisma = new PrismaClient();
  try {
    // 1. Autores
    const autores = new Map<string, string>();
    for (const a of AUTORES) {
      const email = `${a.username}${DOMINIO}`;
      const user = await prisma.user.upsert({
        where: { email },
        update: {
          firstName: a.firstName,
          lastName: a.lastName,
          username: a.username,
          bio: a.bio,
          role: 2,
        },
        create: {
          email,
          firstName: a.firstName,
          lastName: a.lastName,
          username: a.username,
          bio: a.bio,
          role: 2,
        },
      });
      autores.set(a.chave, user.id);
    }
    const idsDosAutores = [...autores.values()];

    // 2. Limpa o que a semeadura criou antes
    const antigos = await prisma.blogArticle.findMany({
      where: { authorId: { in: idsDosAutores } },
      select: { id: true },
    });
    // As respostas primeiro: a relação entre comentários não apaga em cascata.
    const idsAntigos = antigos.map((x) => x.id);
    await prisma.blogComment.deleteMany({
      where: { articleId: { in: idsAntigos }, parentId: { not: null } },
    });
    await prisma.blogComment.deleteMany({
      where: { articleId: { in: idsAntigos } },
    });
    await prisma.blogArticle.deleteMany({
      where: { id: { in: antigos.map((x) => x.id) } },
    });

    // 3. Categorias (as novas; as que já existiam só são lidas)
    for (const c of CATEGORIAS) {
      await prisma.blogCategory.upsert({
        where: { slug: c.slug },
        update: {
          name: c.name,
          description: c.description,
          order: c.order,
          inMoreMenu: c.more,
          showOnHome: c.slug === 'seculo-xx',
          translation: { name: c.en },
        },
        create: {
          slug: c.slug,
          name: c.name,
          description: c.description,
          order: c.order,
          inMoreMenu: c.more,
          showOnHome: c.slug === 'seculo-xx',
          showInMenu: true,
          isActive: true,
          translation: { name: c.en },
        },
      });
    }
    // Romântico (anterior à semente) também ganha seção no início.
    await prisma.blogCategory.updateMany({
      where: { slug: 'romantico' },
      data: { showOnHome: true },
    });
    const categorias = new Map(
      (
        await prisma.blogCategory.findMany({ select: { id: true, slug: true } })
      ).map((c) => [c.slug, c.id]),
    );

    // 4. Tags
    for (const [slug, en] of TAGS) {
      const nome = slug.replace(/-/g, ' ');
      const existente = await prisma.blogTag.findFirst({
        where: { OR: [{ slug }, { name: nome }] },
      });
      if (existente) {
        await prisma.blogTag.update({
          where: { id: existente.id },
          data: { translation: { name: en } },
        });
      } else {
        await prisma.blogTag.create({
          data: { slug, name: nome, translation: { name: en } },
        });
      }
    }
    const tags = new Map(
      (await prisma.blogTag.findMany({ select: { id: true, slug: true } })).map(
        (t) => [t.slug, t.id],
      ),
    );

    // 5. Artigos. Destaque: os da semente tomam as posições 1 a 3.
    await prisma.blogArticle.updateMany({
      where: { isFeatured: true },
      data: { isFeatured: false, featuredOrder: null },
    });
    const leitores = await prisma.user.findMany({
      where: { email: { not: { endsWith: DOMINIO } } },
      select: { id: true },
      take: 6,
    });

    for (const a of ARTIGOS) {
      const compositor = await prisma.composer.findUnique({
        where: { id: COMPOSITORES[a.compositor] },
        select: { id: true, portraitUrl: true },
      });
      const obras: string[] = [];
      if (compositor) {
        for (const trecho of a.obras ?? []) {
          const obra = await prisma.work.findFirst({
            where: {
              composerId: compositor.id,
              title: { contains: escapeRegex(trecho), mode: 'insensitive' },
            },
            select: { id: true },
          });
          if (obra) obras.push(obra.id);
        }
      }
      const publicado = new Date(Date.now() - a.dias * DIA - 9 * 3_600_000);
      const capa = original(compositor?.portraitUrl);
      const palavras = JSON.stringify(a.corpo).split(/\s+/).length;

      const artigo = await prisma.blogArticle.create({
        data: {
          title: a.titulo,
          slug: a.slug,
          description: a.resumo,
          content: a.corpo as Prisma.InputJsonValue,
          coverImage: capa,
          coverImageAlt: capa ? `Retrato de ${a.compositor}` : null,
          coverImageCredit: capa ? 'IMSLP, domínio público' : null,
          status: 'PUBLISHED',
          publishedAt: publicado,
          createdAt: publicado,
          isFeatured: Boolean(a.destaque),
          featuredOrder: a.destaque ?? null,
          authorId: autores.get(a.autor)!,
          composerIds: compositor ? [compositor.id] : [],
          workIds: obras,
          viewCount: a.visitas,
          readCount: Math.round(a.visitas * 0.42),
          estimatedReadTime: Math.max(2, Math.round(palavras / 220)),
          backgroundMusicAutoplay: false,
          language: 'pt',
          translation: a.en
            ? ({
                title: a.en.titulo,
                description: a.en.resumo,
                content: a.en.corpo,
              } as Prisma.InputJsonValue)
            : undefined,
          categories: {
            create: a.categorias
              .filter((s) => categorias.has(s))
              .map((s) => ({ categoryId: categorias.get(s)! })),
          },
          tags: {
            create: a.tags
              .filter((s) => tags.has(s))
              .map((s) => ({ tagId: tags.get(s)! })),
          },
        },
      });

      // Curtidas e comentários dos leitores que já existem no banco local.
      const quantos = Math.min(leitores.length, Math.round(a.visitas / 800));
      for (const leitor of leitores.slice(0, quantos)) {
        await prisma.blogLike
          .create({ data: { articleId: artigo.id, userId: leitor.id } })
          .catch(() => undefined);
      }
      if (a.visitas > 2000 && leitores.length >= 2) {
        const primeiro = await prisma.blogComment.create({
          data: {
            articleId: artigo.id,
            userId: leitores[0].id,
            content:
              'Que texto bom. Fui ouvir de novo depois de ler e reparei em coisas que nunca tinha notado.',
          },
        });
        await prisma.blogComment.create({
          data: {
            articleId: artigo.id,
            userId: leitores[1].id,
            parentId: primeiro.id,
            content:
              'Aconteceu o mesmo comigo. A lista do que ouvir ajudou muito.',
          },
        });
      }
    }

    // 6. Contagem das tags
    for (const [slug, id] of tags) {
      const n = await prisma.blogArticleTag.count({ where: { tagId: id } });
      await prisma.blogTag.update({ where: { id }, data: { articleCount: n } });
      void slug;
    }

    // 7. Agenda: três destaques em cada um dos próximos três meses
    await prisma.event.updateMany({
      where: { isFeatured: true },
      data: { isFeatured: false, featuredOrder: null, featuredSize: null },
    });
    const hoje = new Date();
    for (let m = 0; m < 3; m++) {
      const inicio = new Date(
        Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + m, 1, 3),
      );
      const fim = new Date(
        Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + m + 1, 1, 3),
      );
      const eventos = await prisma.event.findMany({
        where: {
          status: 'PUBLISHED',
          startDate: { gte: m === 0 ? hoje : inicio, lt: fim },
        },
        orderBy: { startDate: 'asc' },
        take: 3,
        select: { id: true },
      });
      for (const [i, e] of eventos.entries()) {
        await prisma.event.update({
          where: { id: e.id },
          data: {
            isFeatured: true,
            featuredOrder: i + 1,
            featuredSize: i === 0 ? 'large' : 'normal',
          },
        });
      }
    }

    const total = await prisma.blogArticle.count({
      where: { status: 'PUBLISHED' },
    });
    console.log(
      `Blog semeado: ${ARTIGOS.length} artigos da semente, ${total} publicados no total.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
