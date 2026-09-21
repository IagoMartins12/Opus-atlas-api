import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TextIndexService } from '../../common/search/text-index.service';
import { JobStatusService } from '../../common/queue/job-status.service';

/** Coleções que a busca depende de ter índice de texto. */
const SEARCHABLE = ['Work', 'Composer', 'blog_articles'] as const;

interface DbStats {
  collections: number;
  objects: number;
  dataSize: number;
  storageSize: number;
  indexes: number;
  indexSize: number;
  fsUsedSize?: number;
  fsTotalSize?: number;
}

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Saúde do sistema, medida.
 *
 * **O painel do legado era inventado, campo por campo.** Não é força de
 * expressão — está escrito no código dele:
 *
 * ```js
 * diskSpace: { total: 100 * 1024 * 1024 * 1024 },  // 100GB simulado
 * database:  { size: diskUsed * 0.6,               // Aproximação
 *              collections: 15,                    // Número de models principais
 *              indexHealth: 95 },                  // Simulado
 * ```
 *
 * E a listagem de coleções para backup seletivo devolvia
 * `estimatedRecords: Math.floor(Math.random() * 10000) + 100` — **números
 * aleatórios**, sobre os quais o administrador escolhia o que copiar.
 *
 * Aqui cada número vem de `dbStats` ou de uma contagem real, e o que não dá
 * para medir simplesmente não aparece. Duas ausências que valem explicar:
 *
 * - **Espaço em disco da aplicação não existe mais como métrica.** Desde a
 *   Etapa 0 nenhum arquivo é gravado localmente: o contêiner é efêmero e tudo
 *   vai para o Cloudinary. O que existe é o disco do **servidor de banco**, que
 *   é o que `fsTotalSize` mede — e está rotulado como tal.
 * - **"Saúde dos índices" não é medível assim.** O legado devolvia 95 fixo. O
 *   que dá para responder de verdade é se os índices de texto estão de pé, e é
 *   isso que aparece.
 */
@Injectable()
export class SystemHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly textIndex: TextIndexService,
    private readonly jobs: JobStatusService,
  ) {}

  async snapshot() {
    const [stats, counts, queues] = await Promise.all([
      this.dbStats(),
      this.recordCounts(),
      this.jobs.health(),
    ]);

    const search = SEARCHABLE.map((collection) => ({
      collection,
      textIndex: this.textIndex.hasTextIndex(collection),
    }));

    return {
      database: {
        collections: stats?.collections ?? null,
        documents: stats?.objects ?? null,
        dataSizeBytes: stats?.dataSize ?? null,
        storageSizeBytes: stats?.storageSize ?? null,
        indexes: stats?.indexes ?? null,
        indexSizeBytes: stats?.indexSize ?? null,
      },
      /** Disco do **servidor de banco**, não do contêiner da API. */
      databaseHostDisk:
        stats?.fsTotalSize && stats.fsUsedSize
          ? {
              totalBytes: stats.fsTotalSize,
              usedBytes: stats.fsUsedSize,
              usedPercent:
                Math.round((stats.fsUsedSize / stats.fsTotalSize) * 1000) / 10,
            }
          : null,
      records: counts,
      search: {
        // Um `false` aqui significa que a busca daquela coleção caiu no regex
        // e varre tudo. `prisma db push` derruba estes índices; a tarefa
        // `search.reindex` os recria sem reiniciar.
        collections: search,
        allIndexed: search.every((entry) => entry.textIndex),
      },
      queues,
      measuredAt: new Date(),
    };
  }

  /**
   * `dbStats` do MongoDB.
   *
   * Nunca lança: um painel de saúde que devolve 500 porque o comando de
   * estatística falhou é um painel que some justamente quando algo está
   * errado. Falha vira `null`, e o `null` é visível na resposta.
   */
  private async dbStats(): Promise<DbStats | null> {
    try {
      const raw = (await this.prisma.$runCommandRaw({
        dbStats: 1,
        scale: 1,
      })) as Record<string, unknown>;

      return {
        collections: asNumber(raw.collections) ?? 0,
        objects: asNumber(raw.objects) ?? 0,
        dataSize: asNumber(raw.dataSize) ?? 0,
        storageSize: asNumber(raw.storageSize) ?? 0,
        indexes: asNumber(raw.indexes) ?? 0,
        indexSize: asNumber(raw.indexSize) ?? 0,
        fsUsedSize: asNumber(raw.fsUsedSize) ?? undefined,
        fsTotalSize: asNumber(raw.fsTotalSize) ?? undefined,
      };
    } catch {
      return null;
    }
  }

  /** Contagens que o administrador de fato usa para dimensionar trabalho. */
  private async recordCounts() {
    const [
      users,
      composers,
      works,
      scores,
      articles,
      assets,
      auditLogs,
      tokens,
      notifications,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.composer.count(),
      this.prisma.work.count(),
      this.prisma.workScore.count(),
      this.prisma.blogArticle.count(),
      this.prisma.storedAsset.count(),
      this.prisma.adminAuditLog.count(),
      this.prisma.userToken.count(),
      this.prisma.notification.count(),
    ]);

    return {
      users,
      composers,
      works,
      scores,
      articles,
      storedAssets: assets,
      auditLogs,
      userTokens: tokens,
      notifications,
    };
  }
}
