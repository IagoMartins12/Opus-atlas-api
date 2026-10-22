import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AiTextService } from '../../ai/ai-text.service';
import { RecommendationsService } from '../../catalog/recommendations/recommendations.service';
import { errorMessage } from '../../common/utils/error.util';
import { PrismaService } from '../../prisma/prisma.service';
import { ProgressReportQueryDto } from './dto/report-query.dto';
import { ProgressReportService } from './progress-report.service';
import { ReportSectionsService } from './report-sections.service';

export interface ApprovedPiece {
  workId: string;
  title: string;
  composer: string;
  note: string | null;
}

const MAX_TIPS = 6;

type SkillsSection = ReturnType<ReportSectionsService['skills']>;
type InsightsSection = ReturnType<ReportSectionsService['insights']>;
type OverviewSection = ReturnType<ReportSectionsService['overview']>;

/**
 * O relatório pedagógico do Maestro (21/10/2026): o que vai além dos números.
 *
 * **Nada chega ao aluno sem o professor.** As próximas peças vêm do motor de
 * recomendações e as dicas vêm rascunhadas pela IA; as duas coisas voltam para
 * o professor, que escolhe, edita e só então compartilha (`nextPieces` e `tips`
 * no relatório). O rascunho nunca é gravado.
 */
@Injectable()
export class PedagogicalService {
  private readonly logger = new Logger(PedagogicalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ProgressReportService,
    private readonly recommendations: RecommendationsService,
    private readonly ai: AiTextService,
  ) {}

  async requireMaestro(teacherUserId: string) {
    if (!(await this.reports.hasAdvancedReports(teacherUserId))) {
      throw new ForbiddenException('O relatório pedagógico é do plano Maestro');
    }
  }

  /** Sugestões de próximas peças para o professor escolher. */
  async nextPieces(teacherUserId: string, studentId: string) {
    await this.requireMaestro(teacherUserId);
    const { student } = await this.reports.requireAccess(
      teacherUserId,
      studentId,
    );
    const items = await this.recommendations.forStudent(student.userId, 12);
    return { items };
  }

  /**
   * Confere e completa as peças que o professor aprovou: só obras que existem,
   * sem repetir, com título e compositor gravados (o relatório é um retrato).
   */
  async approvedPieces(
    pieces: Array<{ workId: string; note?: string }> | undefined,
  ): Promise<ApprovedPiece[]> {
    if (!pieces?.length) return [];
    const ids = [...new Set(pieces.map((p) => p.workId))];
    const works = await this.prisma.work.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true, composer: { select: { name: true } } },
    });
    const byId = new Map(works.map((w) => [w.id, w]));
    const seen = new Set<string>();
    return pieces.flatMap((piece) => {
      const work = byId.get(piece.workId);
      if (!work || seen.has(work.id)) return [];
      seen.add(work.id);
      return [
        {
          workId: work.id,
          title: work.title,
          composer: work.composer.name,
          note: piece.note?.trim() || null,
        },
      ];
    });
  }

  /** Dicas limpas: sem vazias, sem repetidas, no máximo seis. */
  cleanTips(tips: string[] | undefined): string[] {
    const seen = new Set<string>();
    return (tips ?? [])
      .map((tip) => tip.trim())
      .filter((tip) => {
        const key = tip.toLowerCase();
        if (!tip || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_TIPS);
  }

  /**
   * O rascunho das dicas: a IA lê os fatos do período e escreve; sem IA (ou se
   * ela falhar), as regras escrevem. O professor revisa antes de publicar.
   */
  async draftTips(
    teacherUserId: string,
    studentId: string,
    query: ProgressReportQueryDto,
  ) {
    await this.requireMaestro(teacherUserId);
    const generated = await this.reports.generate(teacherUserId, studentId, {
      period: query.period,
      from: query.from,
      to: query.to,
      sections: ['overview', 'insights', 'skills', 'assignments'],
    });
    const report = generated.report as {
      overview: OverviewSection;
      insights?: InsightsSection;
      skills?: SkillsSection;
    };
    const firstName = generated.student.name.split(' ')[0] || 'o aluno';
    const facts = this.factsOf(report);
    const fallback = this.ruleTips(report, firstName);

    if (!this.ai.enabled) return { tips: fallback, generatedBy: 'rules' };

    try {
      const result = await this.ai.complete({
        system:
          'Você ajuda um professor de música a escrever dicas de estudo para o aluno, em português do Brasil, falando direto com o aluno ("você"). Cada dica é concreta e praticável (o que fazer, como, por quanto tempo), com uma ou duas frases e até 220 caracteres. Use só os fatos recebidos: não invente obras, números, notas nem diagnósticos. Sem emoji, sem elogio vazio. Responda só com um array JSON de 3 a 5 strings.',
        prompt: JSON.stringify({
          aluno: firstName,
          periodo: generated.period.label,
          fatos: facts,
        }),
        maxTokens: 1200,
      });
      const match = /\[[\s\S]*\]/.exec(result.text);
      const parsed = match ? (JSON.parse(match[0]) as unknown) : null;
      const tips = Array.isArray(parsed)
        ? this.cleanTips(
            parsed.filter(
              (t): t is string => typeof t === 'string' && t.length <= 400,
            ),
          )
        : [];
      if (tips.length >= 2) return { tips, generatedBy: result.generatedBy };
    } catch (error) {
      this.logger.warn(`Dicas por IA falharam: ${errorMessage(error)}`);
    }
    return { tips: fallback, generatedBy: 'rules' };
  }

  /** O que a IA lê: só números e rótulos do relatório, sem nome completo. */
  private factsOf(report: {
    overview: OverviewSection;
    insights?: InsightsSection;
    skills?: SkillsSection;
  }) {
    const o = report.overview;
    return {
      aulas: `${o.completedLessons} de ${o.totalLessons}`,
      presenca: o.attendanceRate,
      tarefasConcluidas: o.assignmentCompletionRate,
      engajamento: o.avgEngagement,
      preparo: o.avgPreparation,
      pontosFortes: report.insights?.strengths.map((s) => s.item) ?? [],
      desafios: report.insights?.challenges.map((s) => s.item) ?? [],
      sinais: report.insights?.signals.map((s) => s.detail) ?? [],
      habilidades: (report.skills?.skills ?? []).map((s) => ({
        habilidade: s.label,
        notaAtual: s.current,
        variacao: s.change,
        aulas: s.lessons,
        minutosDePratica: s.practiceMinutes,
      })),
    };
  }

  /** Dicas pelas regras, para quando não há IA. Sempre apoiadas num número. */
  ruleTips(
    report: {
      overview: OverviewSection;
      insights?: InsightsSection;
      skills?: SkillsSection;
    },
    firstName: string,
  ): string[] {
    const tips: string[] = [];
    const skills = report.skills?.skills ?? [];
    const rated = skills.filter((s) => s.current !== null);
    const weakest = [...rated].sort(
      (a, b) => (a.current ?? 5) - (b.current ?? 5),
    )[0];
    const falling = skills.find((s) => s.change !== null && s.change < 0);
    const unpracticed = skills.find(
      (s) => s.lessons >= 2 && s.practiceMinutes === 0,
    );
    const o = report.overview;

    if (weakest && (weakest.current ?? 5) < 3.5) {
      tips.push(
        `${weakest.label} é o ponto a firmar agora. Reserve 10 minutos no começo de cada estudo só para isso, devagar, antes do repertório.`,
      );
    }
    if (falling && falling !== weakest) {
      tips.push(
        `${falling.label} caiu um pouco no período. Volte ao que funcionava: andamento mais lento e trechos curtos, até ficar confortável de novo.`,
      );
    }
    if (unpracticed) {
      tips.push(
        `${unpracticed.label} aparece nas aulas, mas não na sua prática registrada. Inclua um bloco curto para isso na semana e registre no diário.`,
      );
    }
    if (
      o.assignmentCompletionRate !== null &&
      o.assignmentCompletionRate < 60
    ) {
      tips.push(
        'Várias tarefas ficaram pelo caminho. Divida cada uma em partes de 15 minutos e marque um dia fixo da semana para cada parte.',
      );
    }
    if (o.avgPreparation !== null && o.avgPreparation < 3) {
      tips.push(
        'Chegar com a tarefa estudada faz a aula render mais. Na véspera, passe uma vez por tudo o que foi pedido, mesmo que rápido.',
      );
    }
    const challenge = report.insights?.challenges[0]?.item;
    if (challenge) {
      tips.push(
        `O desafio que mais apareceu foi "${challenge}". Trabalhe ele isolado, fora da peça, e depois devolva ao contexto.`,
      );
    }
    if (tips.length === 0) {
      tips.push(
        `Bom período, ${firstName}. Mantenha a constância: estudar um pouco todo dia rende mais que uma sessão longa na véspera da aula.`,
      );
    }
    return tips.slice(0, 5);
  }
}
