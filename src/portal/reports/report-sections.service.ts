import { Injectable } from '@nestjs/common';
import {
  AssignmentStatus,
  DifficultyLevel,
  LessonStatus,
} from '@prisma/client';
import { ResolvedPeriod } from './report-period';

/**
 * Dados carregados uma vez e reaproveitados por todas as seções.
 *
 * O legado refazia as mesmas consultas dentro de cada gerador de seção: o
 * relatório completo lia as aulas do período pelo menos quatro vezes.
 */
export interface ReportInput {
  lessons: LessonFact[];
  assignments: AssignmentFact[];
  learned: LearnedFact[];
  wantToLearn: WantToLearnFact[];
  period: ResolvedPeriod;
}

export interface LessonFact {
  id: string;
  status: LessonStatus;
  scheduledAt: Date;
  duration: number;
  engagement: number | null;
  preparation: number | null;
  punctuality: string | null;
  topics: string[];
  techniques: string[];
  challenges: string[];
  improvements: string[];
  skillsWorked: string[];
  studentPresent: boolean | null;
}

export interface AssignmentFact {
  id: string;
  type: string;
  status: AssignmentStatus;
  isCompleted: boolean;
  dueDate: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  estimatedTime: number | null;
  actualTime: number | null;
  teacherRating: number | null;
  /** Dificuldade percebida pelo aluno, 1–5. */
  studentRating: number | null;
}

export interface LearnedFact {
  learnedAt: Date;
  mastery: number;
  wouldRecommend: boolean;
  workId: string;
  workTitle: string;
  composerName: string;
  /** Nível da obra na fonte (IMSLP), quando conhecido. */
  difficulty: string | null;
}

export interface WantToLearnFact {
  addedAt: Date;
  workId: string;
  workTitle: string;
  composerName: string;
  difficulty: DifficultyLevel | null;
}

const round = (value: number, decimals = 1): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Média de uma lista, ou `null` quando não há amostra. */
const average = (values: number[]): number | null =>
  values.length > 0
    ? round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;

/** Percentual, ou `null` quando o denominador é zero. */
const rate = (part: number, total: number): number | null =>
  total > 0 ? round((part / total) * 100) : null;

const MONTH_KEY = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

@Injectable()
export class ReportSectionsService {
  /**
   * Números de base do período.
   *
   * Toda taxa devolve `null` quando não há amostra, em vez de um valor
   * inventado. O legado usava `100` como presença padrão e `50` como percentil
   * padrão, o que fazia um aluno sem nenhuma aula aparecer com presença
   * perfeita.
   */
  overview(input: ReportInput) {
    const { lessons, assignments } = input;

    const completed = this.countStatus(lessons, LessonStatus.COMPLETED);
    const cancelled = this.countStatus(lessons, LessonStatus.CANCELLED);
    const noShow = this.countStatus(lessons, LessonStatus.NO_SHOW);
    const scheduled = this.countStatus(lessons, LessonStatus.SCHEDULED);
    const attended = completed + noShow;

    const completedAssignments = assignments.filter(
      (assignment) => assignment.isCompleted,
    ).length;

    return {
      totalLessons: lessons.length,
      completedLessons: completed,
      cancelledLessons: cancelled,
      noShowLessons: noShow,
      scheduledLessons: scheduled,
      lessonMinutes: lessons
        .filter((lesson) => lesson.status === LessonStatus.COMPLETED)
        .reduce((total, lesson) => total + lesson.duration, 0),
      attendanceRate: rate(completed, attended),
      totalAssignments: assignments.length,
      completedAssignments,
      assignmentCompletionRate: rate(completedAssignments, assignments.length),
      avgEngagement: average(
        lessons
          .map((lesson) => lesson.engagement)
          .filter((value): value is number => value !== null),
      ),
      avgPreparation: average(
        lessons
          .map((lesson) => lesson.preparation)
          .filter((value): value is number => value !== null),
      ),
      avgTeacherRating: average(
        assignments
          .map((assignment) => assignment.teacherRating)
          .filter((value): value is number => value !== null),
      ),
      worksLearned: input.learned.length,
    };
  }

  /** Presença mês a mês, com a tendência entre o primeiro e o último mês. */
  attendance(input: ReportInput) {
    const byMonth = new Map<
      string,
      { completed: number; noShow: number; onTime: number; rated: number }
    >();

    for (const lesson of input.lessons) {
      if (
        lesson.status !== LessonStatus.COMPLETED &&
        lesson.status !== LessonStatus.NO_SHOW
      ) {
        continue;
      }

      const key = MONTH_KEY(lesson.scheduledAt);
      const bucket = byMonth.get(key) ?? {
        completed: 0,
        noShow: 0,
        onTime: 0,
        rated: 0,
      };

      if (lesson.status === LessonStatus.COMPLETED) {
        bucket.completed += 1;
      } else {
        bucket.noShow += 1;
      }

      if (lesson.punctuality) {
        bucket.rated += 1;

        if (
          lesson.punctuality === 'on_time' ||
          lesson.punctuality === 'early'
        ) {
          bucket.onTime += 1;
        }
      }

      byMonth.set(key, bucket);
    }

    const months = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, bucket]) => ({
        month,
        attended: bucket.completed,
        missed: bucket.noShow,
        attendanceRate: rate(
          bucket.completed,
          bucket.completed + bucket.noShow,
        ),
        punctualityRate: rate(bucket.onTime, bucket.rated),
      }));

    const first = months[0]?.attendanceRate ?? null;
    const last = months[months.length - 1]?.attendanceRate ?? null;

    return {
      months,
      trend:
        first !== null && last !== null && months.length > 1
          ? round(last - first)
          : null,
    };
  }

  /** Volume e engajamento mês a mês. */
  evolution(input: ReportInput) {
    const byMonth = new Map<
      string,
      {
        lessons: number;
        minutes: number;
        engagement: number[];
        assignments: number;
      }
    >();

    const bucketFor = (key: string) =>
      byMonth.get(key) ?? {
        lessons: 0,
        minutes: 0,
        engagement: [],
        assignments: 0,
      };

    for (const lesson of input.lessons) {
      if (lesson.status !== LessonStatus.COMPLETED) {
        continue;
      }

      const key = MONTH_KEY(lesson.scheduledAt);
      const bucket = bucketFor(key);

      bucket.lessons += 1;
      bucket.minutes += lesson.duration;

      if (lesson.engagement !== null) {
        bucket.engagement.push(lesson.engagement);
      }

      byMonth.set(key, bucket);
    }

    for (const assignment of input.assignments) {
      if (!assignment.isCompleted || !assignment.completedAt) {
        continue;
      }

      const key = MONTH_KEY(assignment.completedAt);
      const bucket = bucketFor(key);

      bucket.assignments += 1;
      byMonth.set(key, bucket);
    }

    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, bucket]) => ({
        month,
        lessons: bucket.lessons,
        minutes: bucket.minutes,
        completedAssignments: bucket.assignments,
        avgEngagement: average(bucket.engagement),
      }));
  }

  /**
   * Análise das tarefas.
   *
   * `difficultyRating` sai de `studentRating` — a dificuldade que o próprio
   * aluno registrou. No legado esse número era `Math.random() * 5 + 1`.
   */
  assignments(input: ReportInput) {
    const byType = new Map<
      string,
      {
        total: number;
        completed: number;
        onTime: number;
        withDueDate: number;
        difficulty: number[];
        estimated: number;
        actual: number;
        timed: number;
      }
    >();

    for (const assignment of input.assignments) {
      const bucket = byType.get(assignment.type) ?? {
        total: 0,
        completed: 0,
        onTime: 0,
        withDueDate: 0,
        difficulty: [],
        estimated: 0,
        actual: 0,
        timed: 0,
      };

      bucket.total += 1;

      if (assignment.isCompleted) {
        bucket.completed += 1;
      }

      if (assignment.dueDate && assignment.completedAt) {
        bucket.withDueDate += 1;

        if (assignment.completedAt <= assignment.dueDate) {
          bucket.onTime += 1;
        }
      }

      if (assignment.studentRating !== null) {
        bucket.difficulty.push(assignment.studentRating);
      }

      if (assignment.estimatedTime !== null && assignment.actualTime !== null) {
        bucket.estimated += assignment.estimatedTime;
        bucket.actual += assignment.actualTime;
        bucket.timed += 1;
      }

      byType.set(assignment.type, bucket);
    }

    const overdue = input.assignments.filter(
      (assignment) =>
        !assignment.isCompleted &&
        assignment.dueDate !== null &&
        assignment.dueDate < input.period.end,
    ).length;

    return {
      overdue,
      punctualityRate: this.punctualityRate(input.assignments),
      byType: [...byType.entries()].map(([type, bucket]) => ({
        type,
        total: bucket.total,
        completed: bucket.completed,
        completionRate: rate(bucket.completed, bucket.total),
        onTimeRate: rate(bucket.onTime, bucket.withDueDate),
        // Dificuldade percebida pelo aluno, quando ele registrou.
        difficultyRating: average(bucket.difficulty),
        // Razão entre tempo real e estimado; acima de 1 leva mais tempo do que
        // o professor previu.
        timeRatio:
          bucket.timed > 0 && bucket.estimated > 0
            ? round(bucket.actual / bucket.estimated, 2)
            : null,
      })),
    };
  }

  private punctualityRate(assignments: AssignmentFact[]): number | null {
    const withDeadline = assignments.filter(
      (assignment) => assignment.dueDate !== null && assignment.completedAt,
    );

    const onTime = withDeadline.filter(
      (assignment) => assignment.completedAt! <= assignment.dueDate!,
    ).length;

    return rate(onTime, withDeadline.length);
  }

  /**
   * Repertório trabalhado.
   *
   * `satisfactionRate` sai de `Learned.wouldRecommend`, que é uma resposta real
   * do aluno. No legado era `Math.random() * 30 + 70` — um número entre 70 e
   * 100 que, por construção, nunca podia indicar insatisfação.
   */
  repertoire(input: ReportInput) {
    const { learned, wantToLearn } = input;

    const byComposer = new Map<string, number>();

    for (const work of learned) {
      byComposer.set(
        work.composerName,
        (byComposer.get(work.composerName) ?? 0) + 1,
      );
    }

    const recommended = learned.filter((work) => work.wouldRecommend).length;

    return {
      worksLearned: learned.length,
      worksInProgress: wantToLearn.length,
      avgMastery: average(learned.map((work) => work.mastery)),
      satisfactionRate: rate(recommended, learned.length),
      difficultyMix: this.difficultyMix(learned),
      topComposers: [...byComposer.entries()]
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([composer, count]) => ({ composer, count })),
      recentlyLearned: learned
        .slice()
        .sort((a, b) => b.learnedAt.getTime() - a.learnedAt.getTime())
        .slice(0, 10)
        .map((work) => ({
          workId: work.workId,
          title: work.workTitle,
          composer: work.composerName,
          learnedAt: work.learnedAt,
          mastery: work.mastery,
        })),
    };
  }

  private difficultyMix(learned: LearnedFact[]) {
    const counts = new Map<string, number>();

    for (const work of learned) {
      const key = work.difficulty ?? 'UNKNOWN';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return [...counts.entries()].map(([level, count]) => ({
      level,
      count,
      share: rate(count, learned.length),
    }));
  }

  /**
   * Padrões de engajamento.
   *
   * `preferenceScore` por tópico vem do engajamento médio registrado nas aulas
   * em que o tópico apareceu, ponderado pela frequência. No legado era
   * `Math.random() * 100`.
   */
  engagement(input: ReportInput) {
    const completed = input.lessons.filter(
      (lesson) => lesson.status === LessonStatus.COMPLETED,
    );

    return {
      avgEngagement: average(
        completed
          .map((lesson) => lesson.engagement)
          .filter((value): value is number => value !== null),
      ),
      avgPreparation: average(
        completed
          .map((lesson) => lesson.preparation)
          .filter((value): value is number => value !== null),
      ),
      byWeekday: this.byWeekday(completed),
      topics: this.scoreByTag(completed, (lesson) => lesson.topics),
      techniques: this.scoreByTag(completed, (lesson) => lesson.techniques),
    };
  }

  private byWeekday(lessons: LessonFact[]) {
    const buckets = Array.from({ length: 7 }, () => ({
      lessons: 0,
      engagement: [] as number[],
    }));

    for (const lesson of lessons) {
      const bucket = buckets[lesson.scheduledAt.getDay()];
      bucket.lessons += 1;

      if (lesson.engagement !== null) {
        bucket.engagement.push(lesson.engagement);
      }
    }

    return buckets.map((bucket, weekday) => ({
      weekday,
      lessons: bucket.lessons,
      avgEngagement: average(bucket.engagement),
    }));
  }

  /**
   * Pontua cada tópico ou técnica pelo engajamento das aulas em que apareceu.
   *
   * `preferenceScore` é a média de engajamento normalizada para 0–100; fica
   * `null` quando nenhuma daquelas aulas teve engajamento registrado, em vez
   * de virar zero — não ter medida é diferente de ter medido zero.
   */
  private scoreByTag(
    lessons: LessonFact[],
    pick: (lesson: LessonFact) => string[],
  ) {
    const byTag = new Map<string, { count: number; engagement: number[] }>();

    for (const lesson of lessons) {
      for (const tag of pick(lesson)) {
        const bucket = byTag.get(tag) ?? { count: 0, engagement: [] };
        bucket.count += 1;

        if (lesson.engagement !== null) {
          bucket.engagement.push(lesson.engagement);
        }

        byTag.set(tag, bucket);
      }
    }

    return [...byTag.entries()]
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 15)
      .map(([tag, bucket]) => {
        const avg = average(bucket.engagement);

        return {
          tag,
          lessons: bucket.count,
          avgEngagement: avg,
          // Engajamento é 1–5; normalizado para 0–100.
          preferenceScore: avg !== null ? round(((avg - 1) / 4) * 100) : null,
        };
      });
  }

  /**
   * Leitura pedagógica.
   *
   * Só afirma o que os dados sustentam: cada item traz a amostra em que se
   * apoia, e nada é devolvido quando não há amostra suficiente.
   */
  insights(input: ReportInput) {
    const completed = input.lessons.filter(
      (lesson) => lesson.status === LessonStatus.COMPLETED,
    );

    const strengths = this.topItems(
      completed.flatMap((lesson) => lesson.improvements),
    );
    const challenges = this.topItems(
      completed.flatMap((lesson) => lesson.challenges),
    );
    const skills = this.topItems(
      completed.flatMap((lesson) => lesson.skillsWorked),
    );

    const overview = this.overview(input);

    return {
      sampleSize: completed.length,
      strengths,
      challenges,
      skillsWorked: skills,
      signals: this.signals(overview, input),
    };
  }

  /**
   * Sinais objetivos, cada um com o número que o sustenta.
   *
   * Substitui o "estilo de aprendizado" do legado, que era escolhido por uma
   * cadeia de `if` sobre médias e apresentado como diagnóstico.
   */
  private signals(
    overview: ReturnType<ReportSectionsService['overview']>,
    input: ReportInput,
  ) {
    const signals: Array<{ kind: string; detail: string; value: number }> = [];

    if (overview.attendanceRate !== null && overview.attendanceRate < 75) {
      signals.push({
        kind: 'attendance_low',
        detail: 'Presença abaixo de 75% no período',
        value: overview.attendanceRate,
      });
    }

    if (
      overview.assignmentCompletionRate !== null &&
      overview.assignmentCompletionRate < 60
    ) {
      signals.push({
        kind: 'assignments_low',
        detail: 'Menos de 60% das tarefas concluídas',
        value: overview.assignmentCompletionRate,
      });
    }

    if (overview.avgEngagement !== null && overview.avgEngagement >= 4) {
      signals.push({
        kind: 'engagement_high',
        detail: 'Engajamento médio igual ou acima de 4 em 5',
        value: overview.avgEngagement,
      });
    }

    const punctuality = this.punctualityRate(input.assignments);

    if (punctuality !== null && punctuality < 50) {
      signals.push({
        kind: 'deadlines_missed',
        detail: 'Menos da metade das tarefas entregues no prazo',
        value: punctuality,
      });
    }

    return signals;
  }

  private topItems(items: string[]) {
    const counts = new Map<string, number>();

    for (const item of items) {
      const key = item.trim();

      if (key.length > 0) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([item, count]) => ({ item, count }));
  }

  /** Comparação com a janela anterior de mesma duração. */
  comparison(
    current: ReturnType<ReportSectionsService['overview']>,
    previous: ReturnType<ReportSectionsService['overview']>,
  ) {
    const delta = (a: number | null, b: number | null): number | null =>
      a !== null && b !== null ? round(a - b) : null;

    return {
      previous,
      change: {
        completedLessons: current.completedLessons - previous.completedLessons,
        completedAssignments:
          current.completedAssignments - previous.completedAssignments,
        attendanceRate: delta(current.attendanceRate, previous.attendanceRate),
        assignmentCompletionRate: delta(
          current.assignmentCompletionRate,
          previous.assignmentCompletionRate,
        ),
        avgEngagement: delta(current.avgEngagement, previous.avgEngagement),
      },
    };
  }

  private countStatus(lessons: LessonFact[], status: LessonStatus): number {
    return lessons.filter((lesson) => lesson.status === status).length;
  }
}
