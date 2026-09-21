import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildInsight, Insight, percent } from './insight';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A partir de quantos dias uma intenção parada vira sinal de travamento. */
const STALE_INTENT_DAYS = 90;

const EVIDENCE = 20;

@Injectable()
export class LearningInsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async collect(): Promise<Insight[]> {
    const [conversion, stalled, mastery, breadth] = await Promise.all([
      this.intentConversion(),
      this.stalledIntents(),
      this.masteryDistribution(),
      this.repertoireBreadth(),
    ]);

    return [conversion, stalled, mastery, breadth];
  }

  /**
   * Quanto do "quero aprender" vira "já aprendi".
   *
   * É o funil central do produto: o aluno declara a intenção e, em algum
   * momento, declara a conclusão. A taxa diz se a plataforma está ajudando a
   * atravessar essa distância ou só a colecionar intenções.
   */
  private async intentConversion(): Promise<Insight> {
    const [intents, learned] = await Promise.all([
      this.prisma.wantToLearn.count(),
      this.prisma.learned.count(),
    ]);

    const rate = percent(learned, intents + learned);

    return buildInsight({
      code: 'learning.intent_conversion',
      title: 'Conversão de "quero aprender" em "já aprendi"',
      severity:
        rate === null
          ? 'healthy'
          : rate < 15
            ? 'warning'
            : rate < 35
              ? 'opportunity'
              : 'healthy',
      detail: `${learned} conclusões para ${intents} intenções em aberto. A taxa mede quanto da intenção declarada chega ao fim.`,
      value: rate,
      unit: 'percent',
      sampleSize: intents + learned,
      minimumSample: 20,
      action:
        rate !== null && rate < 35
          ? 'Verificar se as obras mais marcadas têm partitura e material de apoio.'
          : undefined,
      evidence: [{ intencoesAbertas: intents, conclusoes: learned }],
    });
  }

  /**
   * Intenções paradas há muito tempo.
   *
   * Uma obra marcada como "quero aprender" há mais de três meses e nunca
   * concluída é um aluno travado — e a obra que mais se repete nessa lista
   * costuma ser a peça difícil demais para o material disponível.
   */
  private async stalledIntents(): Promise<Insight> {
    const cutoff = new Date(Date.now() - STALE_INTENT_DAYS * DAY_MS);

    const [stale, total] = await Promise.all([
      this.prisma.wantToLearn.count({ where: { addedAt: { lt: cutoff } } }),
      this.prisma.wantToLearn.count(),
    ]);

    const worst = await this.prisma.wantToLearn.groupBy({
      by: ['workId'],
      where: { addedAt: { lt: cutoff } },
      _count: { _all: true },
      orderBy: { _count: { workId: 'desc' } },
      take: EVIDENCE,
    });

    const works = await this.prisma.work.findMany({
      where: { id: { in: worst.map((row) => row.workId) } },
      select: { id: true, title: true, composer: { select: { name: true } } },
    });

    const byId = new Map(works.map((work) => [work.id, work]));
    const share = percent(stale, total);

    return buildInsight({
      code: 'learning.stalled_intents',
      title: `Intenções paradas há mais de ${STALE_INTENT_DAYS} dias`,
      severity:
        share === null ? 'healthy' : share > 60 ? 'warning' : 'opportunity',
      detail: `${stale} de ${total} marcações de "quero aprender" seguem em aberto há mais de ${STALE_INTENT_DAYS} dias.`,
      value: share,
      unit: 'percent',
      sampleSize: total,
      minimumSample: 20,
      action:
        share !== null && share > 40
          ? 'Olhar as obras que mais se repetem: costumam ser as difíceis demais para o material disponível.'
          : undefined,
      evidence: worst.map((row) => ({
        workId: row.workId,
        title: byId.get(row.workId)?.title ?? null,
        composer: byId.get(row.workId)?.composer.name ?? null,
        alunosParados: row._count._all,
      })),
    });
  }

  /**
   * Distribuição do domínio declarado nas obras concluídas.
   *
   * Domínio baixo concentrado indica conclusão declarada sem segurança — o
   * aluno marca como aprendida uma obra que ainda não domina.
   */
  private async masteryDistribution(): Promise<Insight> {
    const learned = await this.prisma.learned.findMany({
      select: { mastery: true },
      take: 5000,
    });

    if (learned.length === 0) {
      return buildInsight({
        code: 'learning.mastery_distribution',
        title: 'Domínio declarado nas obras concluídas',
        severity: 'healthy',
        detail: 'Sem obras concluídas.',
        value: null,
        unit: 'percent',
        sampleSize: 0,
        minimumSample: 20,
      });
    }

    const faixas = { baixo: 0, medio: 0, alto: 0 };

    for (const item of learned) {
      if (item.mastery < 40) {
        faixas.baixo += 1;
      } else if (item.mastery < 75) {
        faixas.medio += 1;
      } else {
        faixas.alto += 1;
      }
    }

    const media =
      Math.round(
        (learned.reduce((sum, item) => sum + item.mastery, 0) /
          learned.length) *
          10,
      ) / 10;

    const shareBaixo = percent(faixas.baixo, learned.length) ?? 0;

    return buildInsight({
      code: 'learning.mastery_distribution',
      title: 'Domínio declarado nas obras concluídas',
      severity: shareBaixo > 40 ? 'opportunity' : 'healthy',
      detail: `Domínio médio de ${media} em 100. ${shareBaixo}% das conclusões ficam abaixo de 40 — obra dada por aprendida sem segurança.`,
      value: media,
      unit: 'ratio',
      sampleSize: learned.length,
      minimumSample: 20,
      evidence: [faixas],
    });
  }

  /**
   * Concentração do repertório.
   *
   * Se poucas obras respondem pela maior parte do estudo, o catálogo é grande
   * mas o uso é estreito — e o esforço de curadoria deveria ir para ampliar o
   * que é efetivamente estudado.
   */
  private async repertoireBreadth(): Promise<Insight> {
    const [porObra, totalObras] = await Promise.all([
      this.prisma.learned.groupBy({
        by: ['workId'],
        _count: { _all: true },
        orderBy: { _count: { workId: 'desc' } },
        take: 100,
      }),
      this.prisma.work.count(),
    ]);

    const totalConclusoes = await this.prisma.learned.count();
    const top10 = porObra
      .slice(0, 10)
      .reduce((sum, row) => sum + row._count._all, 0);

    const concentracao = percent(top10, totalConclusoes);

    return buildInsight({
      code: 'learning.repertoire_breadth',
      title: 'Concentração do repertório estudado',
      severity:
        concentracao === null
          ? 'healthy'
          : concentracao > 50
            ? 'opportunity'
            : 'healthy',
      detail: `As dez obras mais estudadas respondem por ${concentracao ?? 0}% das conclusões, num catálogo de ${totalObras} obras. ${porObra.length} obras distintas foram concluídas ao menos uma vez.`,
      value: concentracao,
      unit: 'percent',
      sampleSize: totalConclusoes,
      minimumSample: 20,
      action:
        concentracao !== null && concentracao > 50
          ? 'Destacar obras fora do topo com material completo, para alargar o uso do catálogo.'
          : undefined,
      evidence: [
        {
          obrasDistintasConcluidas: porObra.length,
          catalogo: totalObras,
          conclusoes: totalConclusoes,
        },
      ],
    });
  }
}
