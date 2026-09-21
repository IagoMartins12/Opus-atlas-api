import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { Readable } from 'stream';
import { createGunzip } from 'zlib';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { appConfiguration } from '../config/configuration';
import { envFilePath } from '../config/env-files';
import { errorMessage } from '../common/utils/error.util';
import { BackupStorageService } from '../admin/backup/backup-storage.service';

/**
 * Restaura um arquivo de backup — ou o recorte de `export-hml.ts`, que tem o
 * mesmo formato — num banco **escolhido explicitamente**.
 *
 * **Por que este script existe.** Até aqui o backup só gravava. Um backup que
 * nunca foi restaurado não é backup: é um arquivo que se espera que funcione.
 * Este é o outro lado, e o primeiro uso dele — semear a homologação — é
 * também o primeiro teste de que o formato volta inteiro.
 *
 * **As travas**, porque a operação apaga dado:
 *
 * - o destino vem de `RESTORE_DATABASE_URL`, **nunca** de `DATABASE_URL`: o
 *   banco que a aplicação usa não é alvo por acidente;
 * - se as duas apontam para o mesmo banco, recusa;
 * - `--confirmar <nome-do-banco>` tem de repetir o nome do banco de destino —
 *   quem digita o nome sabe onde está escrevendo;
 * - coleção de destino com documentos só é esvaziada com `--substituir`;
 * - o schema tem de estar aplicado no destino antes (`prisma:push`). Inserir
 *   sem os índices únicos deixaria entrar duplicata que o push depois
 *   recusaria, e a busca ficaria sem índice de texto.
 *
 * Ao fim, confere coleção por coleção se o destino tem o que o arquivo diz
 * ter.
 *
 * Uso:  RESTORE_DATABASE_URL='mongodb+srv://…/opus-hml' \
 *       node --env-file=.env.local dist/scripts/restore.js \
 *         --arquivo hml-seed-2026-09-21.json.gz --confirmar opus-hml
 *
 *       … --r2 backups/backup-2026-09-21.json.gz   (baixa do bucket)
 */

const LOTE = 500;

type Documento = Record<string, unknown>;

interface Opcoes {
  arquivo?: string;
  r2?: string;
  confirmar?: string;
  substituir: boolean;
}

function lerOpcoes(argv: string[]): Opcoes {
  const valor = (nome: string): string | undefined => {
    const i = argv.indexOf(nome);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  return {
    arquivo: valor('--arquivo'),
    r2: valor('--r2'),
    confirmar: valor('--confirmar'),
    substituir: argv.includes('--substituir'),
  };
}

/** Host e nome do banco de uma URL do Mongo — o que identifica o destino. */
export function identificarBanco(url: string): { host: string; banco: string } {
  const semEsquema = url.replace(/^mongodb(\+srv)?:\/\//, '');
  const semCredencial = semEsquema.slice(semEsquema.lastIndexOf('@') + 1);
  const [host, resto = ''] = semCredencial.split('/');
  const banco = resto.split('?')[0];

  return { host: host.toLowerCase(), banco };
}

/**
 * Confere as travas antes de tocar em qualquer coisa. Separada de `main` para
 * ser testável: é a parte do script em que um erro custa um banco.
 */
export function conferirDestino(
  destino: string | undefined,
  origem: string | undefined,
  confirmar: string | undefined,
): { host: string; banco: string } {
  if (!destino) {
    throw new Error(
      'Defina RESTORE_DATABASE_URL com o banco de destino. O restore nunca ' +
        'usa DATABASE_URL, que é o banco da aplicação.',
    );
  }

  const alvo = identificarBanco(destino);

  if (!alvo.banco) {
    throw new Error(
      'RESTORE_DATABASE_URL precisa trazer o nome do banco no caminho ' +
        '(…mongodb.net/opus-hml?…). Sem ele o Mongo escolhe um padrão, e não ' +
        'se restaura num banco que não se sabe qual é.',
    );
  }

  if (origem) {
    const app = identificarBanco(origem);
    if (app.host === alvo.host && app.banco === alvo.banco) {
      throw new Error(
        `RESTORE_DATABASE_URL aponta para o mesmo banco que DATABASE_URL ` +
          `(${alvo.banco}). Recusado: seria restaurar por cima da origem.`,
      );
    }
  }

  if (confirmar !== alvo.banco) {
    throw new Error(
      `Confirme o destino repetindo o nome do banco: --confirmar ${alvo.banco}`,
    );
  }

  return alvo;
}

async function abrirArquivo(opcoes: Opcoes): Promise<Readable> {
  if (opcoes.arquivo && opcoes.r2) {
    throw new Error('Use --arquivo ou --r2, não os dois.');
  }

  if (opcoes.arquivo) return createReadStream(opcoes.arquivo);

  if (opcoes.r2) {
    const storage = new BackupStorageService(
      new ConfigService(appConfiguration()),
    );
    console.log(`Baixando ${opcoes.r2} do bucket…`);
    return Readable.from(await storage.baixar(opcoes.r2));
  }

  throw new Error(
    'Diga de onde vem o backup: --arquivo <caminho> ou --r2 <chave>.',
  );
}

async function contar(prisma: PrismaClient, colecao: string): Promise<number> {
  const resposta = (await prisma.$runCommandRaw({ count: colecao })) as {
    n?: number;
  };
  return Number(resposta.n ?? 0);
}

async function schemaAplicado(prisma: PrismaClient): Promise<boolean> {
  try {
    const resposta = (await prisma.$runCommandRaw({
      listIndexes: 'Work',
    })) as { cursor?: { firstBatch?: unknown[] } };
    // Só o `_id` quer dizer coleção criada à mão, sem o schema.
    return (resposta.cursor?.firstBatch?.length ?? 0) > 1;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const opcoes = lerOpcoes(process.argv.slice(2));
  envFilePath();

  const alvo = conferirDestino(
    process.env.RESTORE_DATABASE_URL,
    process.env.DATABASE_URL,
    opcoes.confirmar,
  );

  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.RESTORE_DATABASE_URL } },
  });

  try {
    if (!(await schemaAplicado(prisma))) {
      throw new Error(
        `O schema não está aplicado em ${alvo.banco}. Rode antes o prisma:push ` +
          'apontando para ele (ver cérebro "Homologação").',
      );
    }

    console.log(`Destino: ${alvo.banco} @ ${alvo.host}\n`);

    const linhas = createInterface({
      input: (await abrirArquivo(opcoes)).pipe(createGunzip()),
      crlfDelay: Infinity,
    });

    const esperado = new Map<string, number>();
    const preparadas = new Set<string>();
    let colecaoAtual: string | null = null;
    let lote: Documento[] = [];
    let inseridos = 0;
    let fim: { colecoes: number; documentos: number } | null = null;

    const descarregar = async (): Promise<void> => {
      if (!colecaoAtual || lote.length === 0) return;
      await prisma.$runCommandRaw({
        insert: colecaoAtual,
        documents: lote,
        ordered: true,
      } as never);
      inseridos += lote.length;
      lote = [];
    };

    for await (const linha of linhas) {
      if (!linha.trim()) continue;

      const registro = JSON.parse(linha) as {
        type: string;
        collection?: string;
        name?: string;
        documents?: number;
        data?: Documento;
        collections?: number;
      };

      if (registro.type === 'end') {
        fim = {
          colecoes: registro.collections ?? -1,
          documentos: registro.documents ?? -1,
        };
        continue;
      }

      if (registro.type === 'collection' && registro.name) {
        await descarregar();
        esperado.set(registro.name, registro.documents ?? 0);
        continue;
      }

      if (registro.type !== 'doc' || !registro.collection || !registro.data) {
        continue;
      }

      if (registro.collection !== colecaoAtual) {
        await descarregar();
        colecaoAtual = registro.collection;

        if (!preparadas.has(colecaoAtual)) {
          const existentes = await contar(prisma, colecaoAtual);

          if (existentes > 0 && !opcoes.substituir) {
            throw new Error(
              `${colecaoAtual} já tem ${existentes} documento(s) em ${alvo.banco}. ` +
                'Use --substituir para esvaziá-la antes.',
            );
          }

          if (existentes > 0) {
            // `delete`, não `drop`: mantém os índices que o prisma:push criou.
            await prisma.$runCommandRaw({
              delete: colecaoAtual,
              deletes: [{ q: {}, limit: 0 }],
            } as never);
          }

          preparadas.add(colecaoAtual);
          console.log(`  restaurando ${colecaoAtual}…`);
        }
      }

      lote.push(registro.data);

      if (lote.length >= LOTE) await descarregar();
    }

    await descarregar();

    /**
     * Sem o marcador de fim, o arquivo foi cortado — e a conferência abaixo
     * não perceberia: ela compara só as coleções que **aparecem** no arquivo.
     * Um arquivo que parou antes de `work_scores` passaria por "conferido",
     * sem partitura nenhuma.
     */
    if (!fim) {
      throw new Error(
        `O arquivo terminou sem o marcador de fim: está incompleto. ` +
          `${inseridos} documentos foram inseridos em ${alvo.banco}, mas o ` +
          'restore NÃO é confiável — gere o arquivo de novo e restaure com ' +
          '--substituir.',
      );
    }

    if (fim.documentos !== inseridos || fim.colecoes !== esperado.size) {
      throw new Error(
        `O arquivo declara ${fim.documentos} documentos em ${fim.colecoes} ` +
          `coleções, mas foram lidos ${inseridos} em ${esperado.size}. ` +
          'O restore NÃO é confiável.',
      );
    }

    console.log(`\n${inseridos} documentos inseridos. Conferindo…\n`);

    let divergencias = 0;

    for (const [colecao, documentos] of esperado) {
      const encontrados = await contar(prisma, colecao);
      const ok = encontrados === documentos;
      if (!ok) divergencias += 1;
      console.log(
        `  ${ok ? 'ok ' : 'ERR'} ${colecao.padEnd(26)} ${encontrados}/${documentos}`,
      );
    }

    if (divergencias > 0) {
      throw new Error(
        `${divergencias} coleção(ões) não bateram com o arquivo. O restore NÃO ` +
          'está completo.',
      );
    }

    console.log(
      '\nRestore conferido: o destino tem exatamente o que o arquivo diz.',
    );
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
