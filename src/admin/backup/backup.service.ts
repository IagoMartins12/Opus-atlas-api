import { Injectable, Logger } from '@nestjs/common';
import { gunzipSync, gzipSync } from 'zlib';
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
 * O processo monta o backup em memória antes de enviar. Sem teto, pedir "tudo"
 * de uma base grande derruba o processo por falta de memória — e derruba a API
 * junto, porque é o mesmo processo. Estourando o teto, a tarefa falha com uma
 * mensagem que diz o que fazer (reduzir o recorte), em vez de morrer.
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

    const { conteudo, contagens, total } = await this.montar(colecoes);
    const comprimido = gzipSync(conteudo, { level: 9 });
    const key = `${this.storage.prefixo}/backup-${this.data(agora)}.json.gz`;

    await this.storage.enviar(key, comprimido);

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
      sizeBytes: comprimido.byteLength,
      documentCount: total,
      collections: contagens,
      verifiedAt: new Date(),
      rotated,
      warnings,
    };
  }

  /**
   * O arquivo, em NDJSON: uma linha de cabeçalho, uma por coleção e uma por
   * documento.
   *
   * **Por que não um JSON só.** Um array gigante precisa estar inteiro na
   * memória para ser lido de volta, e um arquivo truncado vira JSON inválido —
   * ilegível por completo. Em NDJSON, cada linha se lê sozinha: um arquivo
   * cortado ainda entrega tudo o que veio antes do corte.
   *
   * Os documentos vêm da leitura crua do Mongo, que preserva os tipos
   * (`$oid`, `$date`) — o backup volta com ObjectId sendo ObjectId, não texto.
   */
  private async montar(colecoes: ColecaoDeBackup[]): Promise<{
    conteudo: Buffer;
    contagens: Array<{ name: string; documents: number }>;
    total: number;
  }> {
    const partes: string[] = [
      JSON.stringify({
        type: 'meta',
        version: 1,
        generatedAt: new Date().toISOString(),
      }),
    ];

    const contagens: Array<{ name: string; documents: number }> = [];
    let total = 0;
    let bytes = 0;

    for (const colecao of colecoes) {
      let documentos = 0;

      for await (const lote of this.lerColecao(colecao)) {
        for (const documento of lote) {
          const linha = JSON.stringify({
            type: 'doc',
            collection: colecao.name,
            data: documento,
          });

          bytes += linha.length + 1;

          if (bytes > TETO_BYTES) {
            throw new Error(
              `O backup passou de ${Math.round(TETO_BYTES / 1024 / 1024)} MB ` +
                'sem compressão e foi interrompido para não derrubar a API. ' +
                'Reduza o número de registros por coleção nas configurações.',
            );
          }

          partes.push(linha);
          documentos += 1;
        }
      }

      partes.push(
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

    return {
      conteudo: Buffer.from(partes.join('\n'), 'utf8'),
      contagens,
      total,
    };
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
      const baixado = await this.storage.baixar(key);
      const texto = gunzipSync(baixado).toString('utf8');

      let documentos = 0;

      for (const linha of texto.split('\n')) {
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
