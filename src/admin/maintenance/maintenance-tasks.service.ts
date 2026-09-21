import { Injectable, Logger } from '@nestjs/common';
import { NotificationStatus, StorageAssetStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GRAVE_ACTIONS,
  READ_ACTIONS,
  RETENTION_DAYS,
  RetentionClass,
} from './audit-retention';
import { StorageCleanupService } from '../../common/storage/storage-cleanup.service';
import { TextIndexService } from '../../common/search/text-index.service';
import { findTask, MaintenanceTaskId } from './maintenance-catalog';

/** Assinantes por página na varredura de órfãos. */
const SWEEP_PAGE = 500;

/** Quantos órfãos vão como amostra no resultado, para conferência. */
const SAMPLE_SIZE = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Entidades donas de arquivo.
 *
 * Espelha o `entityTypeFor` de `UploadsService`. É lista fechada de propósito:
 * um `entityType` novo aparecendo aqui sem par no `switch` seria um arquivo
 * cuja orfandade ninguém consegue verificar — e o silêncio pareceria "não há
 * órfãos".
 */
const OWNER_TYPES = [
  'user',
  'composer',
  'work',
  'workScore',
  'assignment',
  'blogArticle',
  'blogCategory',
  'advertisement',
] as const;

type OwnerType = (typeof OWNER_TYPES)[number];

export interface MaintenanceRunResult {
  taskId: MaintenanceTaskId;
  /** Verdadeiro quando nada foi alterado — só contado. */
  dryRun: boolean;
  durationMs: number;
  summary: Record<string, number | string>;
  /** Amostra para conferência, quando faz sentido. */
  sample?: string[];
  /** O que a tarefa não conseguiu examinar, quando aplicável. */
  warnings?: string[];
}

/** O que cada tarefa devolve; o resto do resultado é preenchido por `run`. */
export type MaintenanceTaskOutcome = Omit<
  MaintenanceRunResult,
  'taskId' | 'dryRun' | 'durationMs'
>;

export interface MaintenanceRunParams {
  dryRun: boolean;
  retentionDays?: number;
}

/**
 * As implementações do catálogo de manutenção.
 *
 * Cada tarefa é um método privado com uma responsabilidade e um relatório
 * próprio. Nenhuma delas toca disco: o legado tinha rotação de log, limpeza de
 * cache em arquivo e `optimizeDatabase` — três coisas que operavam o disco
 * local de um contêiner efêmero, e que a Etapa 0 aposentou junto com ele.
 */
@Injectable()
export class MaintenanceTasksService {
  private readonly logger = new Logger(MaintenanceTasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageCleanup: StorageCleanupService,
    private readonly textIndex: TextIndexService,
  ) {}

  async run(
    taskId: MaintenanceTaskId,
    params: MaintenanceRunParams,
  ): Promise<MaintenanceRunResult> {
    const task = findTask(taskId);
    const startedAt = Date.now();
    const retentionDays = params.retentionDays ?? task.retentionDays ?? 0;

    this.logger.log(
      `Manutenção ${taskId} iniciada (${params.dryRun ? 'simulação' : 'aplicando'})`,
    );

    const partial = await this.execute(taskId, params.dryRun, retentionDays);

    const result: MaintenanceRunResult = {
      taskId,
      dryRun: params.dryRun,
      durationMs: Date.now() - startedAt,
      ...partial,
    };

    this.logger.log(
      `Manutenção ${taskId} concluída em ${result.durationMs}ms: ` +
        JSON.stringify(result.summary),
    );

    return result;
  }

  private async execute(
    taskId: MaintenanceTaskId,
    dryRun: boolean,
    retentionDays: number,
  ): Promise<MaintenanceTaskOutcome> {
    switch (taskId) {
      case 'storage.cleanup-pending':
        return this.cleanupPending(dryRun);
      case 'storage.orphan-sweep':
        return this.orphanSweep();
      case 'tokens.prune':
        return this.pruneTokens(dryRun, retentionDays);
      case 'notifications.prune':
        return this.pruneNotifications(dryRun, retentionDays);
      case 'audit.prune':
        return this.pruneAudit(dryRun, retentionDays);
      case 'search.reindex':
        return this.reindex();
    }
  }

  // -------------------------------------------------------------------

  private async cleanupPending(
    dryRun: boolean,
  ): Promise<MaintenanceTaskOutcome> {
    const report = await this.storageCleanup.cleanupStalePending(dryRun);

    return {
      summary: {
        examinados: report.pendingExamined,
        removidosDoProvedor: report.uploadedButAbandoned,
        nuncaEnviados: report.neverUploaded,
        falhas: report.failures,
      },
    };
  }

  /**
   * Arquivos ativos cujo dono não existe mais.
   *
   * **Relata, não apaga.** Um arquivo órfão é sintoma de exclusão em cascata
   * incompleta, e apagá-lo automaticamente esconde a causa em vez de mostrar.
   * O legado varria o disco e o Cloudinary inteiro adivinhando o que estava
   * órfão pelo nome da pasta; aqui a pergunta é uma consulta ao próprio banco,
   * porque `StoredAsset` guarda a entidade dona desde a Etapa 0.
   */
  private async orphanSweep(): Promise<MaintenanceTaskOutcome> {
    const byType: Record<string, number> = {};
    const sample: string[] = [];
    const warnings: string[] = [];
    let examined = 0;
    let orphans = 0;

    for (const ownerType of OWNER_TYPES) {
      let cursor: string | undefined;

      for (;;) {
        const page = await this.prisma.storedAsset.findMany({
          where: {
            status: StorageAssetStatus.ACTIVE,
            entityType: ownerType,
            entityId: { not: null },
          },
          select: { id: true, entityId: true, publicId: true },
          orderBy: { id: 'asc' },
          take: SWEEP_PAGE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });

        if (page.length === 0) {
          break;
        }

        examined += page.length;
        cursor = page[page.length - 1].id;

        const ids = [
          ...new Set(
            page
              .map((asset) => asset.entityId)
              .filter((id): id is string => id !== null),
          ),
        ];

        const alive = await this.existingIds(ownerType, ids);

        for (const asset of page) {
          if (asset.entityId && !alive.has(asset.entityId)) {
            orphans += 1;
            byType[ownerType] = (byType[ownerType] ?? 0) + 1;

            if (sample.length < SAMPLE_SIZE) {
              sample.push(`${ownerType}:${asset.entityId} → ${asset.publicId}`);
            }
          }
        }
      }
    }

    // Arquivo ativo sem dono declarado não é órfão — é indeterminado. Aparece
    // como aviso, não como número: dizer "zero órfãos" sem contar o que não deu
    // para verificar seria a conclusão errada.
    const unattached = await this.prisma.storedAsset.count({
      where: {
        status: StorageAssetStatus.ACTIVE,
        OR: [{ entityId: null }, { entityId: { isSet: false } }],
      },
    });

    if (unattached > 0) {
      warnings.push(
        `${unattached} arquivos ativos sem entidade dona declarada — não é ` +
          'possível verificar orfandade deles por consulta',
      );
    }

    return {
      summary: {
        examinados: examined,
        orfaos: orphans,
        semDonoDeclarado: unattached,
        ...byType,
      },
      sample,
      warnings,
    };
  }

  /** Ids que ainda existem, por tipo de dono. `switch` fechado, sem model dinâmico. */
  private async existingIds(
    ownerType: OwnerType,
    ids: string[],
  ): Promise<Set<string>> {
    if (ids.length === 0) {
      return new Set();
    }

    const where = { id: { in: ids } };
    const select = { id: true };

    switch (ownerType) {
      case 'user':
        return this.toSet(await this.prisma.user.findMany({ where, select }));
      case 'composer':
        return this.toSet(
          await this.prisma.composer.findMany({ where, select }),
        );
      case 'work':
        return this.toSet(await this.prisma.work.findMany({ where, select }));
      case 'workScore':
        return this.toSet(
          await this.prisma.workScore.findMany({ where, select }),
        );
      case 'assignment':
        return this.toSet(
          await this.prisma.assignment.findMany({ where, select }),
        );
      case 'blogArticle':
        return this.toSet(
          await this.prisma.blogArticle.findMany({ where, select }),
        );
      case 'blogCategory':
        return this.toSet(
          await this.prisma.blogCategory.findMany({ where, select }),
        );
      case 'advertisement':
        return this.toSet(
          await this.prisma.advertisement.findMany({ where, select }),
        );
    }
  }

  private toSet(rows: { id: string }[]): Set<string> {
    return new Set(rows.map((row) => row.id));
  }

  /**
   * Tokens de uso único mortos.
   *
   * Token vencido não autentica nada — o `validateToken` já o recusa. O que
   * sobra é volume: cada inscrição na newsletter, cada reset de senha e cada
   * convite deixa uma linha para sempre.
   */
  private async pruneTokens(
    dryRun: boolean,
    retentionDays: number,
  ): Promise<MaintenanceTaskOutcome> {
    const cutoff = new Date(Date.now() - retentionDays * DAY_MS);

    const where = {
      OR: [
        { expiresAt: { lt: cutoff } },
        { used: true, createdAt: { lt: cutoff } },
      ],
    };

    if (dryRun) {
      return {
        summary: {
          aRemover: await this.prisma.userToken.count({ where }),
          retencaoEmDias: retentionDays,
        },
      };
    }

    return {
      summary: {
        removidos: (await this.prisma.userToken.deleteMany({ where })).count,
        retencaoEmDias: retentionDays,
      },
    };
  }

  /**
   * Notificações que já não servem a ninguém.
   *
   * Duas regras, e a distinção entre elas é o ponto:
   *
   * - **Prazo vencido**, lida ou não. Uma notificação com `expiresAt` no
   *   passado já está invisível para o dono desde então — o filtro de leitura
   *   (`notExpired`) a esconde. Removê-la não tira nada de ninguém.
   * - **Lida ou dispensada há mais de 90 dias.** Aqui a idade conta, e
   *   **notificação não lida nunca entra por este caminho**: um convite de
   *   professor que o aluno não abriu vale exatamente por não ter sido visto;
   *   apagá-lo por antiguidade apagaria o aviso de quem ainda não olhou.
   *
   * O que garante a segunda regra é uma propriedade do MongoDB que já tinha
   * mordido o filtro de notificações vigentes: `expiresAt: { lt: <data> }`
   * compara por tipo BSON, então **não casa com campo ausente nem nulo**.
   * Medido nesta base: 18 contas, 14 sem `lastSeen`, e um `lt` em data futura
   * distante devolve 4 — só as que têm o campo. Ou seja, notificação sem prazo
   * declarado nunca vence, e sem `readAt` nunca envelhece.
   */
  private async pruneNotifications(
    dryRun: boolean,
    retentionDays: number,
  ): Promise<MaintenanceTaskOutcome> {
    const cutoff = new Date(Date.now() - retentionDays * DAY_MS);

    const where = {
      OR: [
        { expiresAt: { lt: new Date() } },
        {
          status: {
            in: [NotificationStatus.READ, NotificationStatus.DISMISSED],
          },
          readAt: { lt: cutoff },
        },
      ],
    };

    if (dryRun) {
      return {
        summary: { aRemover: await this.prisma.notification.count({ where }) },
      };
    }

    return {
      summary: {
        removidos: (await this.prisma.notification.deleteMany({ where })).count,
      },
    };
  }

  /**
   * Retenção da trilha de auditoria (**RN-5**).
   *
   * O mecanismo existe; o prazo é decisão de produto e por isso não há
   * agendamento sugerido no catálogo. Rodar isto apaga prova de ação
   * administrativa, então a chamada é sempre deliberada.
   */
  /**
   * Aplica a retenção da trilha de auditoria (RN-5).
   *
   * **A retenção é por classe de ação, não um prazo só.** Leitura sai em 90
   * dias, escrita e moderação em 2 anos, e os atos graves — exclusão de conta,
   * mudança de papel, cobrança e extração de dado pessoal — em 5 anos. O
   * argumento está em `audit-retention.ts`: um prazo único obriga a escolher
   * entre perder prova e guardar ruído.
   *
   * O parâmetro `retentionDays` da tarefa **deixou de ser o prazo** e virou um
   * piso: chamar a tarefa com um número menor não encurta nada. Encurtar
   * retenção de auditoria pela chamada seria contornar a política escrevendo um
   * número na requisição.
   */
  private async pruneAudit(
    dryRun: boolean,
    retentionDays: number,
  ): Promise<MaintenanceTaskOutcome> {
    const now = Date.now();
    const classified = [...READ_ACTIONS, ...GRAVE_ACTIONS];

    const buckets: {
      classe: RetentionClass;
      where: Prisma.AdminAuditLogWhereInput;
    }[] = [
      {
        classe: 'read',
        where: {
          action: { in: [...READ_ACTIONS] },
          createdAt: { lt: cutoffFor('read', retentionDays, now) },
        },
      },
      {
        classe: 'grave',
        where: {
          action: { in: [...GRAVE_ACTIONS] },
          createdAt: { lt: cutoffFor('grave', retentionDays, now) },
        },
      },
      {
        // O resto — e `action` é obrigatório no schema, então não há registro
        // fora de nenhum dos três baldes.
        classe: 'write',
        where: {
          action: { notIn: classified },
          createdAt: { lt: cutoffFor('write', retentionDays, now) },
        },
      },
    ];

    const porClasse: Record<string, number> = {};
    let total = 0;

    for (const bucket of buckets) {
      const count = dryRun
        ? await this.prisma.adminAuditLog.count({ where: bucket.where })
        : (await this.prisma.adminAuditLog.deleteMany({ where: bucket.where }))
            .count;

      porClasse[bucket.classe] = count;
      total += count;
    }

    return {
      summary: {
        [dryRun ? 'aRemover' : 'removidos']: total,
        leitura: porClasse.read,
        escrita: porClasse.write,
        graves: porClasse.grave,
        retencaoLeituraEmDias: Math.max(RETENTION_DAYS.read, retentionDays),
        retencaoEscritaEmDias: Math.max(RETENTION_DAYS.write, retentionDays),
        retencaoGravesEmDias: Math.max(RETENTION_DAYS.grave, retentionDays),
      },
    };
  }

  /**
   * Recria os índices de texto.
   *
   * Existe por um caso concreto e reproduzido: `prisma db push` derruba os três
   * índices `$text`, porque o schema do Prisma não tem como declará-los e ele
   * os trata como índices órfãos. Até a subida seguinte, a busca cai no regex e
   * varre 207 mil obras por consulta. Esta tarefa repara sem reiniciar.
   */
  private async reindex(): Promise<MaintenanceTaskOutcome> {
    const report = await this.textIndex.ensureAll();

    return {
      summary: {
        colecoes: report.length,
        prontos: report.filter((entry) => entry.ready).length,
      },
      sample: report.map(
        (entry) => `${entry.collection}: ${entry.ready ? 'ok' : entry.error}`,
      ),
      warnings: report
        .filter((entry) => !entry.ready)
        .map((entry) => `${entry.collection}: ${entry.error}`),
    };
  }
}

/**
 * O instante a partir do qual esta classe pode ser expurgada.
 *
 * `requested` é piso, não teto: uma chamada pedindo retenção menor que a
 * política não encurta a política.
 */
function cutoffFor(
  classe: RetentionClass,
  requested: number,
  now: number,
): Date {
  const days = Math.max(RETENTION_DAYS[classe], requested);

  return new Date(now - days * DAY_MS);
}
