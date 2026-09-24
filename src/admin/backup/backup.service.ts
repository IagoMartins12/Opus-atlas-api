import { createWriteStream, promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';
import { pipeline } from 'stream/promises';
import { createGunzip, createGzip } from 'zlib';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { errorMessage } from '../../common/utils/error.util';
import { BackupStorageService } from './backup-storage.service';

/** Uma coleção escolhida para o backup. `limit` nulo é "tudo". */
export interface ColecaoDeBackup {
  name: string;
  limit: number | null;
}

export interface ResultadoDoBackup {
  objectKey: string;
  sizeBytes: number;
  documentCount: number;
  collections: Array<{ name: string; documents: number }>;
  verifiedAt: Date;
  rotated: string[];
  /** Coleção configurada que não existe mais, e outras surpresas. */
  warnings: string[];
}

/** Quantos documentos por ida ao banco. */
const LOTE = 500;

/**
 * Teto de segurança do arquivo **descomprimido**, em bytes.
 *
 * **Não é mais um teto de memória.** Era: o backup se montava inteiro num
 * array de strings antes de subir, e o teto — 512 MB — devia evitar que isso
 * derrubasse a API. Não evitava nada no plano gratuito do Render, onde o
 * contêiner **tem** 512 MB no total: com 230 MB de dados, o processo morria
 * muito antes de o teto ser consultado, a API reiniciava e a execução ficava
 * "running" para sempre. Aconteceu em homologação, no primeiro backup de
 * verdade.
 *
 * Hoje o arquivo é escrito em disco temporário, em fluxo, e a memória não
 * cresce com o tamanho da base. O teto segue como guarda contra um backup
 * absurdo encher o disco efêmero do contêiner.
 */
const TETO_BYTES = 512 * 1024 * 1024;

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: BackupStorageService,
  ) {}

  /**
   * Gera, envia, **verifica** e só então gira.
   *
   * A ordem importa: girar antes de verificar é como se acumulam três
   * arquivos corrompidos e nenhum bom. Falha em qualquer passo não apaga nada.
   */
  async executar(
    colecoes: ColecaoDeBackup[],
    manter: number,
    agora = new Date(),
    conhecidas?: Set<string>,
  ): Promise<ResultadoDoBackup> {
    if (colecoes.length === 0) {
      throw new Error('Nenhuma coleção selecionada para o backup.');
    }

    /**
     * Coleção que não existe mais lê zero documentos **sem erro nenhum** — o
     * backup sairia menor e com cara de sucesso. Foi assim que um `users`
     * escrito no lugar de `User` passou batido num teste: zero documentos,
     * zero reclamação.
     */
    const warnings: string[] = [];

    if (conhecidas) {
      for (const colecao of colecoes) {
        if (!conhecidas.has(colecao.name)) {
          warnings.push(
            `A coleção "${colecao.name}" está na configuração mas não existe ` +
              'no schema — nada dela entrou no arquivo.',
          );
        }
      }
    }

    const caminho = join(tmpdir(), `opus-backup-${Date.now()}.json.gz`);
    const key = `${this.storage.prefixo}/backup-${this.data(agora)}.json.gz`;

    try {
      const { contagens, total } = await this.gravar(caminho, colecoes);
      const sizeBytes = await this.storage.enviarArquivo(key, caminho);

      const verificado = await this.verificar(key, total);

      if (!verificado) {
        throw new Error(
          `O backup ${key} foi enviado mas não passou na verificação. ` +
            'Nenhum arquivo antigo foi removido.',
        );
      }

      const rotated = await this.girar(manter, key);

      return {
        objectKey: key,
        sizeBytes,
        documentCount: total,
        collections: contagens,
        verifiedAt: new Date(),
        rotated,
        warnings,
      };
    } finally {
      // O disco do contêiner é efêmero, mas não é infinito: um temporário
      // esquecido a cada execução enche o disco em poucos dias.
      await fs.rm(caminho, { force: true });
    }
  }

  /**
   * Escreve o arquivo em disco, em NDJSON comprimido: uma linha de cabeçalho,
   * uma por documento e uma por coleção.
   *
   * **Por que não um JSON só.** Um array gigante precisa estar inteiro na
   * memória para ser lido de volta, e um arquivo truncado vira JSON inválido —
   * ilegível por completo. Em NDJSON, cada linha se lê sozinha: um arquivo
   * cortado ainda entrega tudo o que veio antes do corte.
   *
   * **Por que em disco, e não num `Buffer`.** A versão anterior acumulava
   * todas as linhas num array de strings e só então comprimia. O custo de
   * memória crescia com o tamanho da base — e derrubou a API na primeira
   * execução real, num contêiner de 512 MB. Aqui a memória é a de um lote de
   * 500 documentos, seja a base de 70 mil ou de 7 milhões.
   *
   * `write` devolve `false` quando o buffer do fluxo está cheio; esperar o
   * `drain` é o que impede a fila de escrita de virar, ela mesma, o acúmulo
   * que se queria evitar.
   *
   * Os documentos vêm da leitura crua do Mongo, que preserva os tipos
   * (`$oid`, `$date`) — o backup volta com ObjectId sendo ObjectId, não texto.
   */
  private async gravar(
    caminho: string,
    colecoes: ColecaoDeBackup[],
  ): Promise<{
    contagens: Array<{ name: string; documents: number }>;
    total: number;
  }> {
    const gzip = createGzip({ level: 9 });
    const arquivo = createWriteStream(caminho);
    const escrita = pipeline(gzip, arquivo);

    const contagens: Array<{ name: string; documents: number }> = [];
    let total = 0;
    let bytes = 0;

    const escrever = async (linha: string): Promise<void> => {
      bytes += linha.length + 1;

      if (bytes > TETO_BYTES) {
        throw new Error(
          `O backup passou de ${Math.round(TETO_BYTES / 1024 / 1024)} MB ` +
            'sem compressão e foi interrompido. Reduza o número de registros ' +
            'por coleção nas configurações.',
        );
      }

      if (!gzip.write(`${linha}\n`)) {
        await new Promise<void>((resolve) => gzip.once('drain', resolve));
      }
    };

    try {
      await escrever(
        JSON.stringify({
          type: 'meta',
          version: 1,
          generatedAt: new Date().toISOString(),
        }),
      );

      for (const colecao of colecoes) {
        let documentos = 0;

        for await (const lote of this.lerColecao(colecao)) {
          for (const documento of lote) {
            await escrever(
              JSON.stringify({
                type: 'doc',
                collection: colecao.name,
                data: documento,
              }),
            );
            documentos += 1;
          }
        }

        await escrever(
          JSON.stringify({
            type: 'collection',
            name: colecao.name,
            documents: documentos,
          }),
        );

        contagens.push({ name: colecao.name, documents: documentos });
        total += documentos;

        this.logger.log(`Backup: ${colecao.name} com ${documentos} documentos`);
      }

      // Marcador de fim: o restore recusa arquivo sem ele, que é como se
      // reconhece um arquivo cortado no meio (ver `scripts/restore.ts`).
      await escrever(
        JSON.stringify({
          type: 'end',
          collections: contagens.length,
          documents: total,
        }),
      );

      gzip.end();
      await escrita;
    } catch (erro: unknown) {
      gzip.destroy();
      await escrita.catch(() => undefined);
      throw erro;
    }

    return { contagens, total };
  }

  /**
   * Lê a coleção em lotes, avançando pelo `_id`.
   *
   * **Por que não usar o cursor do Mongo.** A forma natural seria `find` +
   * `getMore`, e foi assim na primeira versão — que falhou no primeiro teste
   * com dado de verdade:
   *
   * ```
   * Error code 43 (CursorNotFound): cursor id 8203700895154827000 not found
   * ```
   *
   * O id do cursor é um inteiro de 64 bits, e um número em JavaScript só
   * guarda 53 bits com exatidão: o id chega arredondado, e o `getMore` pede
   * um cursor que não existe. O erro só aparece quando há **mais de um lote**,
   * ou seja, nunca em teste pequeno.
   *
   * Avançar pelo `_id` não tem esse problema, não expira entre lotes e usa o
   * índice primário. O valor do `_id` é reaproveitado exatamente como o banco
   * o devolveu (`{ $oid: ... }`), então vale para coleção com `_id` de
   * qualquer tipo.
   */
  private async *lerColecao(
    colecao: ColecaoDeBackup,
  ): AsyncGenerator<Record<string, unknown>[]> {
    const limite = colecao.limit ?? 0;
    let restante = limite > 0 ? limite : Number.POSITIVE_INFINITY;
    let ultimoId: unknown = null;

    while (restante > 0) {
      const quantos = Math.min(LOTE, restante);

      const resposta = (await this.prisma.$runCommandRaw({
        find: colecao.name,
        ...(ultimoId === null ? {} : { filter: { _id: { $gt: ultimoId } } }),
        sort: { _id: 1 },
        limit: quantos,
        batchSize: quantos,
      })) as {
        cursor?: { firstBatch?: Record<string, unknown>[] };
      };

      const lote = resposta.cursor?.firstBatch ?? [];

      if (lote.length === 0) return;

      yield lote;

      restante -= lote.length;
      ultimoId = lote[lote.length - 1]._id;

      // Lote menor que o pedido significa fim da coleção.
      if (lote.length < quantos) return;
    }
  }

  /**
   * Baixa o que acabou de subir e lê de volta.
   *
   * Sem este passo, "backup feito" significa apenas "upload não deu erro" — e
   * arquivo truncado, corrompido na compressão ou gravado pela metade passa
   * por bom até o dia em que alguém precisa dele.
   */
  private async verificar(key: string, esperado: number): Promise<boolean> {
    try {
      // Linha a linha, pelo mesmo motivo da gravação: ler o arquivo inteiro
      // na memória para conferi-lo desfaria o cuidado de escrevê-lo em fluxo.
      const corpo = await this.storage.abrirLeitura(key);
      const linhas = createInterface({
        input: corpo.pipe(createGunzip()),
        crlfDelay: Infinity,
      });

      let documentos = 0;

      for await (const linha of linhas) {
        if (linha.startsWith('{"type":"doc"')) documentos += 1;
      }

      if (documentos !== esperado) {
        this.logger.error(
          `Verificação falhou: ${documentos} documentos no arquivo, ${esperado} esperados.`,
        );
        return false;
      }

      return true;
    } catch (erro: unknown) {
      this.logger.error(`Verificação falhou: ${errorMessage(erro)}`);
      return false;
    }
  }

  /** Mantém os `manter` mais recentes; o novo nunca é candidato a sair. */
  private async girar(manter: number, recemCriado: string): Promise<string[]> {
    const arquivos = await this.storage.listar();
    const sobrando = arquivos
      .filter((arquivo) => arquivo.key !== recemCriado)
      .slice(Math.max(manter - 1, 0));

    for (const arquivo of sobrando) {
      await this.storage.apagar(arquivo.key);
    }

    return sobrando.map((arquivo) => arquivo.key);
  }

  /** `2026-09-21`, para o nome do arquivo ordenar sozinho. */
  private data(quando: Date): string {
    return quando.toISOString().slice(0, 10);
  }
}
