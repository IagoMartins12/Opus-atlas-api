import { Injectable } from '@nestjs/common';
import { DifficultyLevel, LessonStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Tamanho mínimo do grupo para haver comparação.
 *
 * Com poucos colegas, "a média do grupo" deixa de ser uma agregação e vira o
 * número de uma pessoa identificável — o professor sabe quem são os outros
 * alunos daquele nível. Abaixo deste piso a seção não é gerada.
 */
const MIN_COHORT = 5;

export interface PeerComparison {
  level: DifficultyLevel;
  cohortSize: number;
  metrics: Array<{
    metric: 'completedLessons' | 'attendanceRate' | 'completedAssignments';
    student: number | null;
    cohortAverage: number;
    /** Fração do grupo com valor menor que o do aluno, em porcentagem. */
    percentile: number | null;
  }>;
}

export interface PeerComparisonUnavailable {
  available: false;
  reason: 'cohort_too_small';
  cohortSize: number;
  minimumCohort: number;
}

@Injectable()
export class PeerComparisonService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compara o aluno com os colegas de mesmo nível do mesmo professor.
   *
   * **O legado não consultava nada.** A "média dos colegas" era o próprio
   * número do aluno multiplicado por um fator aleatório:
   *
   * ```js
   * const avgLessons = Math.round(
   *   currentOverview.completedLessons * (0.8 + Math.random() * 0.4),
   * );
   * ```
   *
   * O comentário no código dizia que era uma simulação para evitar consulta
   * pesada. Três consequências: o percentil mudava a cada recarga da mesma
   * página; como a média derivava do próprio aluno, ele ficava sempre perto do
   * meio e a comparação nunca podia apontar um problema real; e o número era
   * enviado ao aluno num relatório formal como se fosse comparação com colegas.
   *
   * Aqui a média é calculada de verdade, e quando não há grupo suficiente a
   * seção informa que não está disponível — em vez de preencher o espaço.
   */
  async compare(params: {
    teacherId: string;
    studentId: string;
    level: DifficultyLevel;
    start: Date;
    end: Date;
  }): Promise<PeerComparison | PeerComparisonUnavailable> {
    const peers = await this.prisma.teacherStudent.findMany({
      where: {
        teacherId: params.teacherId,
        isActive: true,
        student: { is: { level: params.level } },
      },
      select: { studentId: true },
    });

    const peerIds = peers.map((peer) => peer.studentId);

    if (peerIds.length < MIN_COHORT) {
      return {
        available: false,
        reason: 'cohort_too_small',
        cohortSize: peerIds.length,
        minimumCohort: MIN_COHORT,
      };
    }

    const [lessonRows, assignmentRows] = await Promise.all([
      this.prisma.lesson.groupBy({
        by: ['studentId', 'status'],
        where: {
          teacherId: params.teacherId,
          studentId: { in: peerIds },
          scheduledAt: { gte: params.start, lte: params.end },
        },
        _count: { _all: true },
      }),
      this.prisma.assignment.groupBy({
        by: ['studentId'],
        where: {
          studentId: { in: peerIds },
          isCompleted: true,
          lesson: { is: { teacherId: params.teacherId } },
          createdAt: { gte: params.start, lte: params.end },
        },
        _count: { _all: true },
      }),
    ]);

    const completed = new Map<string, number>();
    const noShow = new Map<string, number>();

    for (const row of lessonRows) {
      if (row.status === LessonStatus.COMPLETED) {
        completed.set(row.studentId, row._count._all);
      } else if (row.status === LessonStatus.NO_SHOW) {
        noShow.set(row.studentId, row._count._all);
      }
    }

    const assignmentsByStudent = new Map(
      assignmentRows.map((row) => [row.studentId, row._count._all]),
    );

    const lessonsPerStudent = peerIds.map((id) => completed.get(id) ?? 0);

    const attendancePerStudent = peerIds
      .map((id) => {
        const done = completed.get(id) ?? 0;
        const missed = noShow.get(id) ?? 0;

        // Aluno sem aula alguma no período não entra no cálculo de presença:
        // ele não tem presença ruim, tem ausência de dado.
        return done + missed > 0 ? (done / (done + missed)) * 100 : null;
      })
      .filter((value): value is number => value !== null);

    const assignmentsPerStudent = peerIds.map(
      (id) => assignmentsByStudent.get(id) ?? 0,
    );

    const studentLessons = completed.get(params.studentId) ?? 0;
    const studentMissed = noShow.get(params.studentId) ?? 0;
    const studentAttendance =
      studentLessons + studentMissed > 0
        ? (studentLessons / (studentLessons + studentMissed)) * 100
        : null;
    const studentAssignments = assignmentsByStudent.get(params.studentId) ?? 0;

    return {
      level: params.level,
      cohortSize: peerIds.length,
      metrics: [
        this.metric('completedLessons', studentLessons, lessonsPerStudent),
        this.metric('attendanceRate', studentAttendance, attendancePerStudent),
        this.metric(
          'completedAssignments',
          studentAssignments,
          assignmentsPerStudent,
        ),
      ],
    };
  }

  /**
   * Monta uma métrica com média e percentil reais.
   *
   * O percentil é a fração do grupo com valor **menor** que o do aluno — a
   * definição usual. O legado devolvia `ratio * 50 + 25` limitado a [5, 95],
   * que não é percentil de nada: um aluno exatamente na média recebia 75.
   */
  private metric(
    metric: PeerComparison['metrics'][number]['metric'],
    studentValue: number | null,
    cohort: number[],
  ): PeerComparison['metrics'][number] {
    const cohortAverage =
      cohort.length > 0
        ? Math.round(
            (cohort.reduce((sum, value) => sum + value, 0) / cohort.length) *
              10,
          ) / 10
        : 0;

    if (studentValue === null || cohort.length === 0) {
      return { metric, student: studentValue, cohortAverage, percentile: null };
    }

    const below = cohort.filter((value) => value < studentValue).length;

    return {
      metric,
      student: Math.round(studentValue * 10) / 10,
      cohortAverage,
      percentile: Math.round((below / cohort.length) * 100),
    };
  }
}
