import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { errorMessage } from '../../common/utils/error.util';
import type { ColecaoDeBackup } from './backup.service';

export interface ColecaoDisponivel {
  /** Nome no banco — é o que vai no arquivo. */
  name: string;
  /** Nome do model no schema, para a tela mostrar algo reconhecível. */
  model: string;
  documents: number;
}

export interface ConfiguracaoDeBackup {
  keep: number;
  collections: ColecaoDeBackup[];
}

/** Quantos arquivos manter, quando ninguém configurou. */
const MANTER_PADRAO = 3;

/**
 * A configuração do backup e a lista do que dá para incluir nele.
 *
 * As coleções vêm do próprio schema (DMMF), não de uma lista escrita à mão:
 * model novo aparece na tela sozinho. Uma lista manual envelheceria em
 * silêncio, e o sintoma seria o pior possível — a coleção nova simplesmente
 * não entra no backup, e ninguém descobre até precisar dela.
 */
@Injectable()
export class BackupSettingsService {
  private readonly logger = new Logger(BackupSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Toda coleção do schema, com a contagem atual. */
  async listarColecoes(): Promise<ColecaoDisponivel[]> {
    const models = Prisma.dmmf.datamodel.models;
    const colecoes: ColecaoDisponivel[] = [];

    for (const model of models) {
      const name = model.dbName ?? model.name;

      colecoes.push({
        name,
        model: model.name,
        documents: await this.contar(name),
      });
    }

    return colecoes.sort((a, b) => a.model.localeCompare(b.model));
  }

  private async contar(colecao: string): Promise<number> {
    try {
      const resultado = (await this.prisma.$runCommandRaw({
        count: colecao,
      })) as { n?: number };

      return resultado.n ?? 0;
    } catch (erro: unknown) {
      // Coleção que ainda não existe conta zero — não é erro de operação.
      this.logger.debug(
        `Não foi possível contar ${colecao}: ${errorMessage(erro)}`,
      );
      return 0;
    }
  }

  async ler(): Promise<ConfiguracaoDeBackup> {
    const gravada = await this.prisma.backupSettings.findFirst();

    if (!gravada) {
      return { keep: MANTER_PADRAO, collections: [] };
    }

    return {
      keep: gravada.keep,
      collections: this.normalizar(gravada.collections),
    };
  }

  async gravar(
    configuracao: ConfiguracaoDeBackup,
    porQuem?: string,
  ): Promise<ConfiguracaoDeBackup> {
    const existente = await this.prisma.backupSettings.findFirst();

    const dados = {
      keep: configuracao.keep,
      collections: configuracao.collections as unknown as Prisma.InputJsonValue,
      updatedBy: porQuem,
    };

    if (existente) {
      await this.prisma.backupSettings.update({
        where: { id: existente.id },
        data: dados,
      });
    } else {
      await this.prisma.backupSettings.create({ data: dados });
    }

    return this.ler();
  }

  /**
   * O JSON gravado volta como `unknown`: só entra o que tem a forma esperada.
   * Configuração corrompida vira lista vazia, e a tarefa recusa rodar dizendo
   * que nada foi selecionado — melhor do que fazer backup de algo aleatório.
   */
  private normalizar(valor: Prisma.JsonValue): ColecaoDeBackup[] {
    if (!Array.isArray(valor)) return [];

    return valor.flatMap((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        return [];
      }

      const registro = item as Record<string, unknown>;
      const name = registro.name;
      const limit = registro.limit;

      if (typeof name !== 'string' || name.length === 0) return [];

      return [
        {
          name,
          limit:
            typeof limit === 'number' && limit > 0 ? Math.floor(limit) : null,
        },
      ];
    });
  }
}
