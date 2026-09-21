import { spawnSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { envFilePath } from '../config/env-files';
import { errorMessage } from '../common/utils/error.util';
import {
  NewsletterIndexesService,
  PARTIAL_UNIQUE_INDEXES,
} from '../newsletter/newsletter-indexes.service';
import { TextIndexService } from '../common/search/text-index.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * `prisma db push` que não quebra e não deixa o banco pior do que achou.
 *
 * **O problema.** Rodar `prisma db push` direto falhava:
 *
 * ```
 * Error code 86 (IndexKeySpecsConflict): An existing index has the same name
 * as the requested index. Requested: { unique: true, key: { userId: 1 },
 * name: "newsletter_subscribers_userId_key" }, existing: { ...same name...,
 * partialFilterExpression: { userId: { $type: "objectId" } } }
 * ```
 *
 * Os dois lados estão certos, e é isso que torna o conflito permanente:
 *
 * - o **schema** precisa do `@unique` em `userId` (a relação 1:1 com `User`
 *   exige) e o Prisma o materializa como índice único comum;
 * - o **`NewsletterIndexesService`** troca esse índice por um **parcial**,
 *   porque no MongoDB um único comum trata campo ausente como valor: só um
 *   documento pode ficar sem ele, e a API não grava `confirmationToken` nem
 *   `unsubscribeToken` no inscrito. Sem a troca, **toda inscrição depois da
 *   primeira falha**.
 *
 * Mesmo nome, especificações diferentes: o `db push` para no meio, e o que ele
 * já aplicou fica aplicado.
 *
 * **E há um segundo estrago, silencioso:** `db push` **derruba os três índices
 * de texto** (`work_text_search`, `composer_text_search`,
 * `article_text_search`), que o schema não tem como declarar. Até a próxima
 * subida da aplicação, a busca cai no regex e varre as coleções inteiras. A
 * regra era "reiniciar depois" — regra que depende de alguém lembrar.
 *
 * **O que este script faz**, na ordem:
 *
 * 1. derruba os índices parciais que vão conflitar (só os que são nossos —
 *    reconhecidos pelo `partialFilterExpression`);
 * 2. roda o `prisma db push`;
 * 3. recria os índices parciais e os de texto, chamando os **mesmos serviços**
 *    que rodam no boot — não há segunda definição para divergir.
 *
 * Entre 1 e 3 existe uma janela em que os índices únicos comuns valem. Por isso
 * isto é passo de implantação, com a aplicação parada — não algo para rodar sob
 * tráfego.
 *
 * Uso:  APP_ENV=local npm run prisma:push
 *       APP_ENV=prd   node dist/scripts/db-push.js
 */

const COLLECTION = 'newsletter_subscribers';

/**
 * Tira da frente os índices que vão conflitar.
 *
 * **Por que a tentativa é cega.** Ler os índices antes seria o natural, mas
 * `listIndexes` pelo Prisma quebra: a resposta traz
 * `partialFilterExpression: { campo: { $type: ... } }`, e `$type` é a marcação
 * que o protocolo JSON do Prisma usa para tipar valor — vira
 * `Unknown tagged value`. Então aqui se derruba pelo nome e se aceita
 * "não existe" como resultado bom.
 */
async function derrubarConflitantes(prisma: PrismaClient): Promise<string[]> {
  const derrubados: string[] = [];

  for (const spec of PARTIAL_UNIQUE_INDEXES) {
    try {
      await prisma.$runCommandRaw({
        dropIndexes: COLLECTION,
        index: spec.name,
      });
      derrubados.push(spec.name);
    } catch (erro: unknown) {
      const mensagem = errorMessage(erro);
      const inexistente =
        mensagem.includes('IndexNotFound') ||
        mensagem.includes('NamespaceNotFound') ||
        mensagem.includes('code 26') ||
        mensagem.includes('code 27');

      if (!inexistente) throw erro;
    }
  }

  return derrubados;
}

async function main(): Promise<void> {
  const arquivoEnv = envFilePath();
  const prisma = new PrismaClient();

  try {
    console.log('1/3  Derrubando os índices que conflitam com o schema…');
    const derrubados = await derrubarConflitantes(prisma);
    console.log(
      derrubados.length > 0
        ? `     ${derrubados.length} derrubado(s): ${derrubados.join(', ')}`
        : '     nenhum (nada a fazer)',
    );

    await prisma.$disconnect();

    console.log(`\n2/3  prisma db push (${arquivoEnv})…`);
    const push = spawnSync(
      process.execPath,
      [
        `--env-file=${arquivoEnv}`,
        'node_modules/prisma/build/index.js',
        'db',
        'push',
        '--skip-generate',
      ],
      { stdio: 'inherit' },
    );

    if (push.status !== 0) {
      throw new Error(
        'O `prisma db push` falhou. Os índices parciais e de texto NÃO foram ' +
          'recriados — rode este comando de novo depois de resolver o erro acima.',
      );
    }

    console.log('\n3/3  Recriando os índices que o push derrubou…');
    const prismaDepois = new PrismaClient();

    try {
      // Os dois serviços usam só `$runCommandRaw` do Prisma; o molde aqui evita
      // subir a aplicação inteira só para recriar índice.
      const comoService = prismaDepois as unknown as PrismaService;

      await new NewsletterIndexesService(comoService).ensurePartialIndexes();

      const relatorio = await new TextIndexService(comoService).ensureAll();

      for (const indice of relatorio) {
        const estado = indice.ready ? 'ok' : `FALHOU (${indice.error ?? '?'})`;
        console.log(`     ${indice.collection}.${indice.name}: ${estado}`);
      }

      if (relatorio.some((indice) => !indice.ready)) {
        throw new Error(
          'Algum índice de texto não foi criado — a busca vai varrer a coleção ' +
            'inteira até isso ser resolvido.',
        );
      }
    } finally {
      await prismaDepois.$disconnect();
    }

    console.log('\nPronto. Schema aplicado e índices no lugar.');
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

void main().catch((erro: unknown) => {
  console.error(`\nFalhou: ${errorMessage(erro)}`);
  process.exit(1);
});
