import type { DifficultyTier } from '../quality/imslp-difficulty';

export interface StartingPiece {
  /** A página da obra no IMSLP: o mesmo número em todo ambiente. */
  imslpId: string;
  why: { pt: string; en: string };
}

export type StartingList = Partial<Record<DifficultyTier, StartingPiece[]>>;

const p = (imslpId: string, pt: string, en: string): StartingPiece => ({
  imslpId,
  why: { pt, en },
});

/**
 * "Por onde começar a tocar", por instrumento: curadoria da casa, revisada
 * pelo dono. O nível vem do Difficulty Project do IMSLP; a escolha das peças e
 * o motivo de cada uma, daqui. A chave é a do site (`/instruments/<key>`).
 * Instrumento fica de fora enquanto o acervo não tiver peças avaliadas para
 * quem começa: oboé, trompete, saxofone e contrabaixo só têm repertório alto.
 */
export const STARTING_LISTS: Readonly<Record<string, StartingList>> = {
  piano: {
    BEGINNER: [
      p(
        '648794',
        'Escrito para as primeiras aulas: mãos perto do teclado e frases curtas.',
        'Written for the first lessons: hands close to the keys and short phrases.',
      ),
      p(
        '116890',
        'Mozart escreveu este minueto aos seis anos. Cabe nas mãos de quem começa.',
        'Mozart wrote this minuet at six. It fits the hands of a beginner.',
      ),
      p(
        '9922',
        'Uma dança de poucos compassos, escrita por Beethoven no fim da vida.',
        'A dance of a few bars, written by Beethoven late in life.',
      ),
      p(
        '6107',
        'Música da casa de Bach, feita para a família: danças e canções curtas.',
        "Music from Bach's home, made for the family: short dances and songs.",
      ),
      p(
        '357193',
        'O minueto que quase todo aluno toca. Foi atribuído a Bach por muito tempo; é de Christian Pezold.',
        'The minuet nearly every student plays. Long credited to Bach, it is by Christian Pezold.',
      ),
      p(
        '301429',
        'Alegre, com saltos de oitava na mão esquerda: o primeiro desafio de deslocamento.',
        'Cheerful, with octave leaps in the left hand: a first test of moving around the keyboard.',
      ),
      p(
        '7798',
        'Danças de Schubert, curtas e com caráter, para treinar ritmo e leveza.',
        'Short, characterful dances by Schubert, to practise rhythm and lightness.',
      ),
      p(
        '7983',
        'Cada estudo tem título e caráter: a técnica já chega como música.',
        'Each study has a title and a character: technique arrives as music.',
      ),
      p(
        '3084',
        'Canções folclóricas húngaras e eslovacas, numa escrita simples e cheia de cor.',
        'Hungarian and Slovak folk songs, in simple and colourful writing.',
      ),
    ],
    INTERMEDIATE: [
      p(
        '2707',
        'Schumann escreveu para as filhas. Começa em peças simples e cresce com quem estuda.',
        'Schumann wrote it for his daughters. It starts simple and grows with the student.',
      ),
      p(
        '6617',
        'A forma sonata em tamanho pequeno: a porta de entrada para Mozart e Beethoven.',
        'Sonata form on a small scale: the way into Mozart and Beethoven.',
      ),
      p(
        '3267',
        'Bach as escreveu para ensinar a ouvir e tocar duas vozes independentes.',
        'Bach wrote them to teach hearing and playing two independent voices.',
      ),
      p(
        '113759',
        'Uma valsa curta e uma boa primeira peça de Chopin.',
        'A short waltz and a good first piece of Chopin.',
      ),
      p(
        '14377',
        'O tema é conhecido; as seções do meio pedem mais do que ele sugere.',
        'The theme is famous; the middle sections ask for more than it suggests.',
      ),
      p(
        '3338',
        'Peças breves de Beethoven, cada uma com uma ideia própria.',
        'Brief pieces by Beethoven, each with an idea of its own.',
      ),
      p(
        '1855',
        'Mozart a anotou como sonata para principiantes, mas a clareza que ela pede é difícil de alcançar.',
        'Mozart noted it as a sonata for beginners, but the clarity it asks for is hard to reach.',
      ),
      p(
        '3_Gymnop%C3%A9dies_(Satie,_Erik)',
        'Poucas notas e muito tempo: o estudo aqui é o som e o pedal.',
        'Few notes and much time: the study here is sound and pedal.',
      ),
    ],
    ADVANCED: [
      p(
        '3268',
        'A continuação das Invenções, agora a três vozes.',
        'The sequel to the Inventions, now in three voices.',
      ),
      p(
        '2312',
        'Os noturnos mais conhecidos de Chopin: canto na mão direita e rubato.',
        "Chopin's best-known nocturnes: song in the right hand, and rubato.",
      ),
      p(
        '4642',
        'Brahms tardio: pede som e fraseado mais do que velocidade.',
        'Late Brahms: it asks for sound and phrasing more than speed.',
      ),
      p(
        '1458',
        'A Sonata ao Luar: o primeiro movimento é o mais tocado, o último é o que exige o nível.',
        'The Moonlight Sonata: the first movement is the most played, the last is what demands the level.',
      ),
      p(
        '1969',
        'Estudos que são obras de concerto: cada um resolve um problema técnico.',
        'Studies that are concert works: each one solves a technical problem.',
      ),
      p(
        '1646',
        'Uma das grandes obras do repertório romântico, narrativa e virtuosística.',
        'One of the great works of the Romantic repertoire, narrative and virtuosic.',
      ),
    ],
  },
  violin: {
    BEGINNER: [
      p(
        '1016114',
        'Estudos elementares que acompanham os primeiros anos do violino.',
        'Elementary studies that go with the first years of the violin.',
      ),
      p(
        '47288',
        'Duos para tocar com o professor, a partir de música folclórica.',
        'Duos to play with the teacher, drawn from folk music.',
      ),
      p(
        '64414',
        'Mozart ainda criança: uma sonata para violino e teclado de escrita simples.',
        'Mozart as a child: a sonata for violin and keyboard in simple writing.',
      ),
    ],
    INTERMEDIATE: [
      p(
        '28348',
        'As sonatas que fundaram a escola do violino barroco.',
        'The sonatas that founded the Baroque violin school.',
      ),
      p(
        '28744',
        'Sonatinas de Schubert: melodia em primeiro lugar, em diálogo com o piano.',
        "Schubert's sonatinas: melody first, in dialogue with the piano.",
      ),
      p(
        '23794',
        'Uma canção de ninar para violino, boa para trabalhar o som.',
        'A lullaby for violin, good for working on sound.',
      ),
      p(
        '718524',
        'Três romances de Clara Schumann, de canto longo.',
        'Three romances by Clara Schumann, in long lines of song.',
      ),
    ],
    ADVANCED: [
      p(
        '126433',
        'O Verão, das Quatro Estações: tempestade e virtuosismo barroco.',
        'Summer, from The Four Seasons: a storm and Baroque virtuosity.',
      ),
      p(
        '4931',
        'Um dos concertos centrais do repertório do violino.',
        'One of the central concertos of the violin repertoire.',
      ),
      p(
        '3645',
        'Os caprichos de Paganini: o teste máximo da técnica.',
        "Paganini's caprices: the ultimate test of technique.",
      ),
    ],
  },
  cello: {
    BEGINNER: [
      p(
        '57843',
        'Um método clássico para os primeiros passos no violoncelo.',
        'A classic method for the first steps on the cello.',
      ),
      p(
        '384191',
        'Estudos fáceis de Sebastian Lee, para firmar arco e mão esquerda.',
        'Easy studies by Sebastian Lee, to settle the bow and the left hand.',
      ),
    ],
    INTERMEDIATE: [
      p(
        '51302',
        'Sonatas barrocas com baixo contínuo, boa ponte para Bach.',
        'Baroque sonatas with continuo, a good bridge to Bach.',
      ),
      p(
        '164349',
        'A suíte mais conhecida de Bach para violoncelo solo. O Prelúdio abre o repertório.',
        "Bach's best-known suite for solo cello. Its Prelude opens the repertoire.",
      ),
      p(
        '30030',
        'Uma peça de concerto curta e brilhante de Saint-Saëns.',
        'A short, brilliant concert piece by Saint-Saëns.',
      ),
    ],
    ADVANCED: [
      p(
        '164350',
        'A segunda suíte de Bach, mais sombria e densa que a primeira.',
        "Bach's second suite, darker and denser than the first.",
      ),
      p(
        '14674',
        'O concerto de Elgar, escrito depois da Primeira Guerra.',
        "Elgar's concerto, written after the First World War.",
      ),
      p(
        '14438',
        'O grande concerto romântico para o instrumento.',
        'The great Romantic concerto for the instrument.',
      ),
    ],
  },
  flute: {
    BEGINNER: [
      p(
        '1015499',
        'Um curso para quem está nas primeiras aulas de flauta.',
        'A course for the first flute lessons.',
      ),
      p(
        '45806',
        'Duas peças curtas de Andersen, flautista que escreveu para o próprio instrumento.',
        'Two short pieces by Andersen, a flautist writing for his own instrument.',
      ),
    ],
    INTERMEDIATE: [
      p(
        '56739',
        'Estudos que a formação de flautistas usa até hoje.',
        'Studies that flautists still train on today.',
      ),
      p(
        '39824',
        'Um andante de Mozart: pouca dificuldade aparente, muita exigência de som.',
        'An andante by Mozart: little apparent difficulty, great demands on sound.',
      ),
      p(
        '54405',
        'Fantasias para flauta sem acompanhamento: a flauta faz melodia e harmonia.',
        'Fantasias for unaccompanied flute: it carries both melody and harmony.',
      ),
    ],
    ADVANCED: [
      p(
        '28016',
        'Debussy para flauta só, de 1913: uma peça que mudou o instrumento.',
        'Debussy for flute alone, from 1913: a piece that changed the instrument.',
      ),
      p(
        '39820',
        'O concerto de Mozart que todo flautista prepara.',
        'The Mozart concerto every flautist prepares.',
      ),
    ],
  },
  guitar: {
    BEGINNER: [
      p(
        '443897',
        'Peças muito fáceis de Diabelli, para as primeiras aulas.',
        'Very easy pieces by Diabelli, for the first lessons.',
      ),
      p(
        '736835',
        'Peças progressivas de Sor, em que cada uma prepara a seguinte.',
        'Progressive pieces by Sor, each preparing the next.',
      ),
      p(
        '95072',
        'Estudos progressivos de Giuliani, para a mão direita ganhar independência.',
        'Progressive studies by Giuliani, for an independent right hand.',
      ),
    ],
    INTERMEDIATE: [
      p(
        '3629',
        'Os estudos de Carcassi, passagem obrigatória do violão clássico.',
        "Carcassi's studies, a required stop on the classical guitar.",
      ),
      p(
        '93234',
        'Estudos de Giuliani com a linguagem do concerto.',
        'Studies by Giuliani in the language of the concert.',
      ),
      p(
        '95949',
        'Uma mazurca breve de Tárrega, primeiro contato com sua escrita.',
        'A brief mazurka by Tárrega, a first contact with his writing.',
      ),
      p(
        '411050',
        'Barcarola de Agustín Barrios, um dos grandes do violão latino-americano.',
        'A barcarolle by Agustín Barrios, one of the great Latin American guitarists.',
      ),
    ],
    ADVANCED: [
      p(
        '54762',
        'Uma serenata de Tárrega, de canto e arpejo.',
        'A serenade by Tárrega, of song and arpeggio.',
      ),
      p(
        '33377',
        'A peça de tremolo mais conhecida do violão.',
        'The best-known tremolo piece for guitar.',
      ),
      p(
        '450061',
        'A obra mais conhecida de Barrios, inspirada numa catedral.',
        'The best-known work by Barrios, inspired by a cathedral.',
      ),
    ],
  },
  organ: {
    BEGINNER: [
      p(
        '4897',
        'Variações de Sweelinck sobre um coral, com a escrita antiga para o órgão.',
        'Variations by Sweelinck on a chorale, in early organ writing.',
      ),
      p(
        '299351',
        'Uma chacona de Pachelbel: o mesmo baixo, variações que crescem.',
        'A chaconne by Pachelbel: the same bass, growing variations.',
      ),
      p(
        '10554',
        'Prelúdios-coral, a última obra de Brahms.',
        'Chorale preludes, the last work of Brahms.',
      ),
    ],
    INTERMEDIATE: [
      p(
        '153147',
        'A fuga "Giga" de Bach, leve, dançada e com pedal ativo.',
        'Bach\'s "Gigue" fugue, light, dancing and with an active pedal.',
      ),
      p(
        '153090',
        'A peça para órgão mais conhecida de todas.',
        'The best-known organ piece of all.',
      ),
    ],
    ADVANCED: [
      p(
        '153709',
        'Bach transcreve um concerto de Johann Ernst para um só instrumentista.',
        'Bach transcribes a concerto by Johann Ernst for a single player.',
      ),
      p(
        '111725',
        'A Grande Fantasia e Fuga: dramática, com uma fuga muito longa.',
        'The Great Fantasia and Fugue: dramatic, with a very long fugue.',
      ),
    ],
  },
  harp: {
    BEGINNER: [
      p(
        '761856',
        'Uma berceuse curta de Hasselmans, professor de harpa em Paris.',
        'A short berceuse by Hasselmans, a harp teacher in Paris.',
      ),
      p(
        '232035',
        'Outra peça de Hasselmans, boa para trabalhar o som sem pressa.',
        'Another piece by Hasselmans, good for working on sound unhurried.',
      ),
    ],
    INTERMEDIATE: [
      p(
        '750783',
        'Os estudos de Bochsa, base da técnica da harpa.',
        "Bochsa's studies, a foundation of harp technique.",
      ),
      p(
        '115896',
        'Prelúdios de Tournier, com a harmonia francesa do século XX.',
        'Preludes by Tournier, in the French harmony of the 20th century.',
      ),
    ],
    ADVANCED: [
      p(
        '46270',
        'O Impromptu de Roussel, peça de concurso e de concerto.',
        "Roussel's Impromptu, a piece for competition and concert.",
      ),
      p(
        '122421',
        'Os Divertissements de Caplet, entre o francês e o espanhol.',
        "Caplet's Divertissements, between French and Spanish.",
      ),
    ],
  },
  clarinet: {
    INTERMEDIATE: [
      p(
        '34139',
        'Debussy escreveu esta peça como prova de leitura para o Conservatório de Paris.',
        'Debussy wrote this piece as a sight-reading test for the Paris Conservatoire.',
      ),
      p(
        '286201',
        'Uma sonata de juventude de Mendelssohn.',
        'A youthful sonata by Mendelssohn.',
      ),
      p(
        '592480',
        'Uma das últimas obras de Poulenc: ironia e melancolia.',
        "One of Poulenc's last works: irony and melancholy.",
      ),
    ],
    ADVANCED: [
      p(
        '24385',
        'Weber escreveu para o clarinetista Heinrich Baermann.',
        'Weber wrote it for the clarinettist Heinrich Baermann.',
      ),
      p(
        '52918',
        'Brahms voltou a compor por causa do clarinetista Richard Mühlfeld.',
        'Brahms returned to composing because of the clarinettist Richard Mühlfeld.',
      ),
      p(
        '179976',
        'Três peças de Stravinsky para clarinete sozinho.',
        'Three pieces by Stravinsky for clarinet alone.',
      ),
    ],
  },
  horn: {
    INTERMEDIATE: [
      p(
        '4588',
        'O mais curto dos concertos de Mozart para trompa.',
        "The shortest of Mozart's horn concertos.",
      ),
      p(
        '1022485',
        'Um andante de Richard Strauss, filho de um trompista.',
        'An andante by Richard Strauss, the son of a horn player.',
      ),
      p(
        '12359',
        'Beethoven escreveu para o trompista Giovanni Punto.',
        'Beethoven wrote it for the horn player Giovanni Punto.',
      ),
    ],
    ADVANCED: [
      p(
        '4595',
        'O concerto de Mozart com o rondó de caça.',
        "Mozart's concerto with the hunting rondo.",
      ),
      p(
        '36026',
        'Strauss tinha dezoito anos quando escreveu este concerto.',
        'Strauss was eighteen when he wrote this concerto.',
      ),
    ],
  },
};
