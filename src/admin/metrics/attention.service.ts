import { Injectable, Logger } from '@nestjs/common';
import {
  ArticleStatus,
  CampaignStatus,
  CommentStatus,
  PlanType,
  SubscriptionPlanStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JobStatusService } from '../../common/queue/job-status.service';
import { errorMessage } from '../../common/utils/error.util';
import { SLA_HOURS } from '../../uploads/moderation/moderation-sla';
import { topPorContagem } from './raw-aggregate';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Backup sem verificação há mais disso pede atenção (ele roda de madrugada). */
const BACKUP_VELHO_HORAS = 48;

/**
 * O que pede alguém hoje — o topo do painel.
 *
 * Uma chamada no lugar das seis que a tela inicial faria (denúncias, blog,
 * filas, backup, cobrança, newsletter). Cada bloco é independente: se as
 * filas não respondem (Redis fora), o bloco delas volta com `erro` e o resto
 * do painel continua de pé — o painel é justamente onde se descobre que algo
 * caiu, e ele não pode cair junto.
 *
 * Só contagens e datas; as frases são da tela.
 */
@Injectable()
export class AttentionService {
  private readonly logger = new Logger(AttentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobStatusService,
  ) {}

  async attention() {
    const agora = new Date();

    const [denuncias, blog, filas, backup, cobranca, newsletter] =
      await Promise.all([
        this.bloco('denuncias', () => this.denuncias(agora)),
        this.bloco('blog', () => this.blog()),
        this.bloco('filas', () => this.filas(agora)),
        this.bloco('backup', () => this.backup(agora)),
        this.bloco('cobranca', () => this.cobranca(agora)),
        this.bloco('newsletter', () => this.newsletter(agora)),
      ]);

    return {
      geradoEm: agora,
      denuncias,
      blog,
      filas,
      backup,
      cobranca,
      newsletter,
    };
  }

  private async bloco<T>(
    nome: string,
    fn: () => Promise<T>,
  ): Promise<T | { erro: string }> {
    try {
      return await fn();
    } catch (error: unknown) {
      this.logger.warn(
        `Bloco "${nome}" do painel falhou: ${errorMessage(error)}`,
      );
      return { erro: 'Não foi possível ler agora.' };
    }
  }

  /** Denúncias abertas, as que passaram do prazo (RN-4) e a mais antiga. */
  private async denuncias(agora: Date) {
    const pendente = { status: 'pending' };

    const [abertas, atrasadas, urgentes, maisAntiga] = await Promise.all([
      this.prisma.uploadModeration.count({ where: pendente }),
      this.prisma.uploadModeration.count({
        where: {
          ...pendente,
          OR: Object.entries(SLA_HOURS).map(([priority, horas]) => ({
            priority,
            createdAt: { lt: new Date(agora.getTime() - horas * HOUR_MS) },
          })),
        },
      }),
      this.prisma.uploadModeration.count({
        where: { ...pendente, priority: { in: ['urgent', 'high'] } },
      }),
      this.prisma.uploadModeration.findFirst({
        where: pendente,
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

    return {
      abertas,
      atrasadas,
      urgentes,
      maisAntigaEm: maisAntiga?.createdAt ?? null,
    };
  }

  /** Comentários esperando decisão e artigos em revisão. */
  private async blog() {
    const [comentarios, sinalizados, emRevisao, artigoComMaisPendentes] =
      await Promise.all([
        this.prisma.blogComment.count({
          where: { status: CommentStatus.PENDING, deletedAt: null },
        }),
        this.prisma.blogComment.count({
          where: {
            deletedAt: null,
            OR: [{ status: CommentStatus.FLAGGED }, { isFlagged: true }],
          },
        }),
        this.prisma.blogArticle.count({
          where: { status: ArticleStatus.REVIEW },
        }),
        // Contado e cortado no banco (ver `topPorContagem`).
        topPorContagem(this.prisma, 'blog_comments', 'articleId', {
          limite: 1,
          match: { status: CommentStatus.PENDING, deletedAt: null },
        }).then((l) =>
          l.map((r) => ({ articleId: r.id, _count: { _all: r.n } })),
        ),
      ]);

    let artigo: { titulo: string; pendentes: number } | null = null;
    const topo = artigoComMaisPendentes[0];
    if (topo) {
      const a = await this.prisma.blogArticle.findUnique({
        where: { id: topo.articleId },
        select: { title: true },
      });
      if (a) artigo = { titulo: a.title, pendentes: topo._count._all };
    }

    return {
      comentarios,
      sinalizados,
      emRevisao,
      artigoComMaisPendentes: artigo,
    };
  }

  /**
   * Falhas das últimas 24 h e filas paradas.
   *
   * A contagem `failed` da fila é o que ficou retido (sete dias), não o que
   * falhou hoje; por isso as falhas são lidas e filtradas pela data. Fila com
   * trabalho esperando e zero worker é o defeito mais grave que existe aqui:
   * as rotas respondem 202 e nada nunca é processado.
   */
  private async filas(agora: Date) {
    const saude = await this.jobs.health();
    const desde = agora.getTime() - DAY_MS;

    const falhas = await Promise.all(
      saude
        .filter((q) => q.counts.failed > 0)
        .map(async (q) => {
          const ultimas = await this.jobs.failures(q.queue, 50);
          const recentes = ultimas.filter(
            (f) => f.failedAt && f.failedAt.getTime() >= desde,
          );
          return {
            fila: q.queue,
            falhas24h: recentes.length,
            ultima: recentes[0]
              ? {
                  job: recentes[0].job,
                  motivo: recentes[0].failedReason,
                  em: recentes[0].failedAt,
                }
              : null,
          };
        }),
    );

    return {
      falhas24h: falhas.reduce((s, f) => s + f.falhas24h, 0),
      porFila: falhas.filter((f) => f.falhas24h > 0),
      paradas: saude
        .filter((q) => q.workers === 0 && q.counts.waiting > 0)
        .map((q) => ({
          fila: q.queue,
          esperando: q.counts.waiting,
          maisAntigoSegundos: q.oldestWaitingSeconds,
        })),
      pausadas: saude.filter((q) => q.paused).map((q) => q.queue),
    };
  }

  private async backup(agora: Date) {
    const [ultimo, ultimoVerificado] = await Promise.all([
      this.prisma.backupRun.findFirst({
        orderBy: { startedAt: 'desc' },
        select: {
          status: true,
          startedAt: true,
          finishedAt: true,
          verifiedAt: true,
          sizeBytes: true,
          documentCount: true,
          error: true,
        },
      }),
      this.prisma.backupRun.findFirst({
        where: { verifiedAt: { not: null } },
        orderBy: { verifiedAt: 'desc' },
        select: { verifiedAt: true },
      }),
    ]);

    const verificadoEm = ultimoVerificado?.verifiedAt ?? null;

    return {
      ultimo,
      verificadoEm,
      velho:
        !verificadoEm ||
        agora.getTime() - verificadoEm.getTime() > BACKUP_VELHO_HORAS * HOUR_MS,
    };
  }

  private async cobranca(agora: Date) {
    const pagos = { planType: { not: PlanType.FREE } };
    const [emAtraso, testesVencendo] = await Promise.all([
      this.prisma.subscription.count({
        where: { ...pagos, status: SubscriptionPlanStatus.PAST_DUE },
      }),
      this.prisma.subscription.count({
        where: {
          status: SubscriptionPlanStatus.TRIAL,
          trialEndDate: {
            gte: agora,
            lte: new Date(agora.getTime() + 3 * DAY_MS),
          },
        },
      }),
    ]);
    return { emAtraso, testesVencendo3Dias: testesVencendo };
  }

  private async newsletter(agora: Date) {
    const [proxima, falhadas] = await Promise.all([
      this.prisma.newsletterCampaign.findFirst({
        where: {
          status: CampaignStatus.SCHEDULED,
          scheduledAt: { gte: agora },
        },
        orderBy: { scheduledAt: 'asc' },
        select: {
          id: true,
          name: true,
          scheduledAt: true,
          totalSubscribers: true,
        },
      }),
      this.prisma.newsletterCampaign.count({
        where: {
          status: CampaignStatus.FAILED,
          updatedAt: { gte: new Date(agora.getTime() - 7 * DAY_MS) },
        },
      }),
    ]);
    return { proxima, falhadas7Dias: falhadas };
  }
}
