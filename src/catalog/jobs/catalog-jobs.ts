import type { CatalogJobWork } from './job-types';
import { work as cleanPortraits } from './clean-placeholder-portraits.job';
import { work as fixDifficulty } from './fix-work-difficulty.job';
import { work as fixEditions } from './fix-imslp-editions.job';
import { work as fixEpochs } from './fix-composer-epochs.job';
import { work as fixInstruments } from './fix-work-instruments.job';
import { work as fixNationalities } from './fix-composer-nationalities.job';
import { work as fixThumbnails } from './fix-imslp-thumbnails.job';
import { work as mergeDuplicates } from './merge-duplicate-composers.job';
import { work as seedCollections } from './seed-collections.job';
import { work as syncAnnotations } from './sync-annotation-counts.job';

/**
 * As rotinas do acervo que o painel executa. **A lista é fechada**: nada de
 * fora escolhe o que roda, só um destes ids.
 *
 * Todas simulam por padrão e só gravam com `apply`; as que juntam registros ou
 * apagam dado pedem confirmação explícita para gravar.
 */
export const CATALOG_JOB_IDS = [
  'fix-epochs',
  'fix-instruments',
  'fix-difficulty',
  'fix-nationalities',
  'fix-editions',
  'clean-portraits',
  'fix-thumbnails',
  'sync-annotation-counts',
  'merge-duplicate-composers',
  'seed-collections',
] as const;

export type CatalogJobId = (typeof CATALOG_JOB_IDS)[number];

export interface CatalogJobParam {
  key: 'limit' | 'pause';
  label: string;
  help: string;
  /** Valor usado quando o campo fica em branco. */
  placeholder: string;
}

export interface CatalogJobDef {
  id: CatalogJobId;
  name: string;
  description: string;
  group: 'compositores' | 'obras' | 'partituras' | 'colecoes';
  /** Junta registros ou apaga dado: gravar pede confirmação. */
  destructive: boolean;
  /** Leva de minutos a horas; a tela avisa e oferece parar. */
  slow: boolean;
  /** Fala com serviços externos (IMSLP, Wikidata). */
  external: boolean;
  params: CatalogJobParam[];
  work: CatalogJobWork;
}

const LIMIT: CatalogJobParam = {
  key: 'limit',
  label: 'Limite',
  help: 'Quantos itens ler nesta rodada. Em branco: todos (e, em simulação, uma amostra).',
  placeholder: 'todos',
};
const PAUSE: CatalogJobParam = {
  key: 'pause',
  label: 'Pausa entre leituras (ms)',
  help: 'Educação com o site de terceiros: mais pausa, menos pressão.',
  placeholder: '1200',
};

export const CATALOG_JOBS: readonly CatalogJobDef[] = [
  {
    id: 'fix-epochs',
    name: 'Corrigir épocas dos compositores',
    description:
      'Troca a época do compositor (e a das obras dele que carregavam a errada) pela que as datas indicam: nascimento mais 30 anos, com folga para quem atravessa períodos. Quem não tem ano de nascimento não é tocado.',
    group: 'compositores',
    destructive: false,
    slow: false,
    external: false,
    params: [],
    work: fixEpochs,
  },
  {
    id: 'fix-nationalities',
    name: 'Nacionalidades pelo Wikidata',
    description:
      'Preenche a nacionalidade de quem está sem ela e troca continente ou "American" errado, pelo Wikidata. Só vale quando o item é pessoa e compositor e o ano de nascimento confere.',
    group: 'compositores',
    destructive: false,
    slow: true,
    external: true,
    params: [LIMIT],
    work: fixNationalities,
  },
  {
    id: 'merge-duplicate-composers',
    name: 'Juntar compositores duplicados',
    description:
      'Funde cadastros do mesmo compositor (mesmo nome completo e datas), movendo obras e coleções para o mais completo e apagando os outros.',
    group: 'compositores',
    destructive: true,
    slow: false,
    external: false,
    params: [],
    work: mergeDuplicates,
  },
  {
    id: 'clean-portraits',
    name: 'Limpar retratos de "sem foto"',
    description:
      'Remove dos compositores o retrato que é o aviso de "sem foto" do IMSLP gravado como imagem.',
    group: 'compositores',
    destructive: false,
    slow: false,
    external: false,
    params: [],
    work: cleanPortraits,
  },
  {
    id: 'fix-instruments',
    name: 'Corrigir instrumento principal das obras',
    description:
      'Reatribui o instrumento principal pelas regras corrigidas (baixo contínuo não é contrabaixo, flauta não é flauta doce, orquestra, coro, voz).',
    group: 'obras',
    destructive: false,
    slow: false,
    external: false,
    params: [],
    work: fixInstruments,
  },
  {
    id: 'fix-difficulty',
    name: 'Corrigir dificuldade das obras',
    description:
      'Estudos de virtuose sobem para avançado; "iniciante" sem sinal no título fica sem dificuldade. Obra verificada ou editada por pessoa não é tocada.',
    group: 'obras',
    destructive: false,
    slow: false,
    external: false,
    params: [],
    work: fixDifficulty,
  },
  {
    id: 'sync-annotation-counts',
    name: 'Alinhar contador de anotações',
    description:
      'Reconcilia o contador de anotações de cada obra com a contagem real, que ordena o catálogo.',
    group: 'obras',
    destructive: false,
    slow: false,
    external: false,
    params: [],
    work: syncAnnotations,
  },
  {
    id: 'fix-editions',
    name: 'Ler a ficha das edições no IMSLP',
    description:
      'Relê no IMSLP o editor, a editora, o copyright e o título das partituras guardadas sem edição. Vai das obras mais baixadas às menos baixadas; a obra lida fica marcada, então pode parar e retomar.',
    group: 'partituras',
    destructive: false,
    slow: true,
    external: true,
    params: [LIMIT, PAUSE],
    work: fixEditions,
  },
  {
    id: 'fix-thumbnails',
    name: 'Corrigir endereço das miniaturas',
    description:
      'Troca o `https:////` gravado pelo raspador antigo por um endereço válido nas miniaturas de partitura.',
    group: 'partituras',
    destructive: false,
    slow: false,
    external: false,
    params: [],
    work: fixThumbnails,
  },
  {
    id: 'seed-collections',
    name: 'Semear coleções editoriais',
    description:
      'Recria as coleções editoriais da casa a partir da lista fixa de compositores e obras. Substitui a coleção de mesmo título.',
    group: 'colecoes',
    destructive: true,
    slow: false,
    external: false,
    params: [],
    work: seedCollections,
  },
];

const BY_ID = new Map<string, CatalogJobDef>(
  CATALOG_JOBS.map((job) => [job.id, job]),
);

export const isCatalogJobId = (value: string): value is CatalogJobId =>
  BY_ID.has(value);

export const findCatalogJob = (id: string): CatalogJobDef => {
  const job = BY_ID.get(id);
  if (!job) throw new Error(`Rotina do acervo desconhecida: ${id}`);
  return job;
};
