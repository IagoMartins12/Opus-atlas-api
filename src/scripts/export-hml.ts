import { createWriteStream, rmSync, statSync } from 'fs';
import { once } from 'events';
import { finished } from 'stream/promises';
import { createGzip } from 'zlib';
import { PrismaClient } from '@prisma/client';
import { envFilePath } from '../config/env-files';
import { errorMessage } from '../common/utils/error.util';

/**
 * Recorte **coerente** do banco, para semear a homologação.
 *
 * **Por que não o backup com limite por coleção.** O backup aceita "N
 * registros de cada coleção", e isso serve para encolher um backup — não para
 * semear um ambiente. Cada coleção é cortada sozinha: as partituras que entram
 * não são as das obras que entraram, e a maior parte dos compositores fica sem
 * obra nenhuma. O ambiente sobe cheio de páginas vazias e links quebrados, que
 * não são defeito do site e mascaram os que são.
 *
 * **Por que recortar.** O banco inteiro tem ~750 MB contando índices, e o
 * Atlas gratuito (M0) para em 512 MB. `Work` sozinha é 83% disso.
 *
 * **O recorte**, seguindo o grafo:
 *
 * - catálogo pequeno (compositores, épocas, instrumentos, blog…) vai inteiro;
 * - de cada compositor, até `--por-compositor` obras-raiz (padrão 5),
 *   preferindo as que **têm partitura** — é o produto, e a página mais rica
 *   para validar — depois as verificadas; cada obra-filha vai junto da mãe;
 * - partituras e estatísticas, só as das obras que entraram;
 * - `User` vai **anonimizado** (ver `anonimizar`): os artigos do blog exigem o
 *   autor, mas homologação tem SMTP funcionando e não pode alcançar gente real;
 * - todo o resto — atividade de usuário, cobrança, tokens, newsletter, aulas,
 *   logs — **fica de fora**. Homologação nasce sem histórico de ninguém.
 *
 * **`stored_assets` fica de fora de propósito, e isso protege a produção.**
 * Homologação usa a mesma conta do Cloudinary (os uploads dela vão para
 * `opus/staging/`), e toda exclusão de arquivo passa por um registro dessa
 * coleção (`StorageService.deleteAsset`/`deleteByEntity`). Sem os registros,
 * homologação não tem como apagar arquivo de produção — nem por engano, nem
 * apagando uma obra que exibe imagem de lá. Não inclua esta coleção.
 *
 * Coleção nova no schema cai em "fora" até alguém decidir o contrário, e o
 * relatório lista quais ficaram de fora: esquecer uma é visível, não
 * silencioso.
 *
 * O arquivo sai no **mesmo formato do backup** (NDJSON + gzip), e é lido pelo
 * mesmo `restore.ts`.
 *
 * Uso:  npm run build
 *       APP_ENV=local node --env-file=.env.local dist/scripts/export-hml.js \
 *         [--por-compositor 5] [--saida hml-seed.json.gz]
 *
 * Só **lê** o banco de origem.
 */

/** Vão inteiras: catálogo e conteúdo editorial, sem dado pessoal. */
const INTEIRAS = [
  'Composer',
  'Epoch',
  'Role',
  'Instrument',
  'WorkGenre',
  'venues',
  'events',
  'blog_articles',
  'blog_article_versions',
  'blog_categories',
  'blog_tags',
  'blog_article_tags',
  'blog_article_categories',
  'blog_media',
  'plan_pricing',
  'newsletter_templates',
  'template_fragments',
  'advertisements',
] as const;

/** Cortadas pelas obras escolhidas. */
const POR_OBRA = ['work_scores', 'score_favorite_stats'] as const;

const LOTE = 500;

type Documento = Record<string, unknown>;

interface Opcoes {
  porCompositor: number;
  saida: string;
}

function lerOpcoes(argv: string[]): Opcoes {
  const valor = (nome: string): string | undefined => {
    const i = argv.indexOf(nome);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const porCompositor = Number(valor('--por-compositor') ?? 5);

  if (!Number.isInteger(porCompositor) || porCompositor < 1) {
    throw new Error('--por-compositor precisa ser um inteiro a partir de 1.');
  }

  const hoje = new Date().toISOString().slice(0, 10);

  return {
    porCompositor,
    saida: valor('--saida') ?? `hml-seed-${hoje}.json.gz`,
  };
}

/** O `_id` como o banco o devolve (`{ $oid }`), em texto, para comparar. */
function chave(id: unknown): string {
  if (id && typeof id === 'object' && '$oid' in id) {
    return String((id as { $oid: string }).$oid);
  }
  return String(id);
}

/**
 * Tira de `User` tudo que identifica ou dá acesso, mantendo o `_id` — é ele que
 * os artigos, obras e partituras referenciam.
 *
 * O e-mail vai para `.invalid`, domínio reservado pela RFC 2606 que nenhum
 * servidor entrega: mesmo que uma campanha dispare em homologação, não sai
 * nada. Sem senha e sem e-mail real, ninguém entra como esse usuário — nem
 * pelo Google, que casa conta por e-mail. O papel volta a comum: acesso de
 * administrador em homologação se cria lá, não se herda.
 */
export function anonimizar(usuario: Documento): Documento {
  const id = chave(usuario._id);
  const curto = id.slice(-6);

  return {
    ...usuario,
    email: `usuario-${id}@opus-hml.invalid`,
    username: `usuario-${curto}-${id.slice(0, 6)}`,
    firstName: 'Usuário',
    lastName: curto,
    hashedPassword: null,
    image: null,
    bio: null,
    phone: null,
    phoneCountryCode: null,
    phoneNumber: null,
    city: null,
    state: null,
    country: null,
    role: 0,
  };
}

/**
 * O filtro de uma página: o do chamador **e** "depois do último `_id`".
 *
 * Tem de ser `$and`. A primeira versão fazia `{ ...filtro, _id: { $gt } }`, e
 * quando o filtro do chamador também era sobre `_id` — `{ _id: { $in: fatia } }`,
 * justamente o das obras escolhidas —, o spread o **apagava** a partir da
 * segunda página. "Estas 500 obras" virava "todas as obras depois desta": o
 * primeiro recorte real trouxe 165 mil obras em vez de 43 mil, com duplicatas.
 */
export function filtroDaPagina(
  filtro: Documento,
  ultimoId: unknown,
): Documento {
  if (ultimoId === null) return filtro;

  const depois = { _id: { $gt: ultimoId } };

  return Object.keys(filtro).length === 0 ? depois : { $and: [filtro, depois] };
}

async function* lerTudo(
  prisma: PrismaClient,
  colecao: string,
  filtro: Documento = {},
): AsyncGenerator<Documento[]> {
  // Avança pelo `_id`, como o backup — o cursor do Mongo tem id de 64 bits e
  // o JavaScript o arredonda (ver `BackupService.lerColecao`).
  let ultimoId: unknown = null;

  for (;;) {
    const filter = filtroDaPagina(filtro, ultimoId);

    const resposta = (await prisma.$runCommandRaw({
      find: colecao,
      filter,
      sort: { _id: 1 },
      limit: LOTE,
      batchSize: LOTE,
    } as never)) as { cursor?: { firstBatch?: Documento[] } };

    const lote = resposta.cursor?.firstBatch ?? [];

    if (lote.length === 0) return;

    yield lote;

    ultimoId = lote[lote.length - 1]._id;

    if (lote.length < LOTE) return;
  }
}

/**
 * Escolhe as obras-raiz: até `porCompositor` de cada compositor, com
 * partitura primeiro. Uma agregação só — uma consulta por compositor seriam
 * 11 mil idas ao banco.
 */
async function escolherObras(
  prisma: PrismaClient,
  porCompositor: number,
): Promise<unknown[]> {
  const resposta = (await prisma.$runCommandRaw({
    aggregate: 'Work',
    pipeline: [
      { $match: { parentWorkId: null } },
      {
        $lookup: {
          from: 'work_scores',
          localField: '_id',
          foreignField: 'workId',
          pipeline: [{ $limit: 1 }, { $project: { _id: 1 } }],
          as: 'umaPartitura',
        },
      },
      {
        $project: {
          composerId: 1,
          temPartitura: { $size: '$umaPartitura' },
          verificada: { $cond: ['$isVerified', 1, 0] },
        },
      },
      { $sort: { composerId: 1, temPartitura: -1, verificada: -1, _id: 1 } },
      { $group: { _id: '$composerId', obras: { $push: '$_id' } } },
      { $project: { obras: { $slice: ['$obras', porCompositor] } } },
      { $unwind: '$obras' },
      { $group: { _id: null, ids: { $push: '$obras' } } },
    ],
    cursor: {},
    allowDiskUse: true,
  } as never)) as { cursor?: { firstBatch?: Array<{ ids: unknown[] }> } };

  return resposta.cursor?.firstBatch?.[0]?.ids ?? [];
}

async function listarColecoes(prisma: PrismaClient): Promise<string[]> {
  const resposta = (await prisma.$runCommandRaw({
    listCollections: 1,
    nameOnly: true,
  })) as { cursor: { firstBatch: Array<{ name: string }> } };

  return resposta.cursor.firstBatch.map((c) => c.name).sort();
}

async function main(): Promise<void> {
  const opcoes = lerOpcoes(process.argv.slice(2));
  envFilePath();
  const prisma = new PrismaClient();

  // Grava em fluxo: o arquivo nunca existe inteiro na memória. Montado de uma
  // vez, o recorte padrão já pedia ~700 MB de pico — e dobrava a cada aumento
  // de `--por-compositor`.
  const gzip = createGzip({ level: 9 });
  const arquivo = createWriteStream(opcoes.saida);
  gzip.pipe(arquivo);

  const escrever = async (registro: unknown): Promise<void> => {
    if (!gzip.write(`${JSON.stringify(registro)}\n`)) {
      await once(gzip, 'drain');
    }
  };

  const contagens: Array<{ name: string; documents: number }> = [];

  const registrar = async (
    colecao: string,
    documentos: Documento[],
  ): Promise<void> => {
    for (const data of documentos) {
      await escrever({ type: 'doc', collection: colecao, data });
    }
  };

  const fechar = async (colecao: string, documentos: number): Promise<void> => {
    await escrever({
      type: 'collection',
      name: colecao,
      documents: documentos,
    });
    contagens.push({ name: colecao, documents: documentos });
    console.log(`  ${colecao.padEnd(26)} ${documentos}`);
  };

  await escrever({
    type: 'meta',
    version: 1,
    generatedAt: new Date().toISOString(),
    kind: 'hml-seed',
    perComposer: opcoes.porCompositor,
  });

  try {
    console.log(
      `Recorte: até ${opcoes.porCompositor} obra(s) por compositor.\n`,
    );

    for (const colecao of INTEIRAS) {
      let n = 0;
      for await (const lote of lerTudo(prisma, colecao)) {
        await registrar(colecao, lote);
        n += lote.length;
      }
      await fechar(colecao, n);
    }

    let usuarios = 0;
    for await (const lote of lerTudo(prisma, 'User')) {
      await registrar('User', lote.map(anonimizar));
      usuarios += lote.length;
    }
    await fechar('User', usuarios);

    const raizes = await escolherObras(prisma, opcoes.porCompositor);
    const obrasIds: unknown[] = [];
    let obras = 0;

    // As raízes escolhidas e, na mesma passada, as filhas de cada lote.
    for (let i = 0; i < raizes.length; i += LOTE) {
      const fatia = raizes.slice(i, i + LOTE);

      for (const filtro of [
        { _id: { $in: fatia } },
        { parentWorkId: { $in: fatia } },
      ]) {
        for await (const lote of lerTudo(prisma, 'Work', filtro)) {
          await registrar('Work', lote);
          obras += lote.length;
          for (const obra of lote) obrasIds.push(obra._id);
        }
      }
    }
    await fechar('Work', obras);

    for (const colecao of POR_OBRA) {
      let n = 0;
      for (let i = 0; i < obrasIds.length; i += LOTE) {
        const filtro = { workId: { $in: obrasIds.slice(i, i + LOTE) } };
        for await (const lote of lerTudo(prisma, colecao, filtro)) {
          await registrar(colecao, lote);
          n += lote.length;
        }
      }
      await fechar(colecao, n);
    }

    const incluidas = new Set(contagens.map((c) => c.name));
    const fora = (await listarColecoes(prisma)).filter(
      (c) => !incluidas.has(c),
    );

    const total = contagens.reduce((s, c) => s + c.documents, 0);

    // Sem esta linha o restore recusa o arquivo: é o que distingue um arquivo
    // inteiro de um que parou no meio (ver `restore.ts`).
    await escrever({
      type: 'end',
      collections: contagens.length,
      documents: total,
    });

    gzip.end();
    await finished(arquivo);
    const tamanho = statSync(opcoes.saida).size;
    console.log(
      `\n${total} documentos, ${(tamanho / 1024 / 1024).toFixed(1)} MB ` +
        `comprimidos → ${opcoes.saida}`,
    );
    console.log(`\nFicaram de fora (${fora.length}): ${fora.join(', ')}`);
  } catch (erro: unknown) {
    // Arquivo pela metade não pode ficar parecendo um recorte.
    gzip.destroy();
    arquivo.destroy();
    rmSync(opcoes.saida, { force: true });
    throw erro;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((erro: unknown) => {
    console.error(`\nFalhou: ${errorMessage(erro)}`);
    process.exit(1);
  });
}
