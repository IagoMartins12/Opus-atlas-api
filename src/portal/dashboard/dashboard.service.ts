import { ForbiddenException, Injectable } from '@nestjs/common';
import { LessonStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

/** Quantos itens cada lista do painel traz. */
const UPCOMING_LIMIT = 10;
const RECENT_LIMIT = 5;
const STUDENTS_LIMIT = 20;
const STUDY_LIMIT = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Janela que define "aluno com atividade recente". */
const RECENT_ACTIVITY_DAYS = 30;

const PERSON_SELECT = {
  id: true,
  userId: true,
  user: { select: { firstName: true, lastName: true, image: true } },
} as const;

const LESSON_CARD_SELECT = {
  id: true,
  title: true,
  scheduledAt: true,
  duration: true,
  status: true,
  location: true,
  objectives: true,
  homework: true,
  publicNotes: true,
} as const;

const ASSIGNMENT_CARD_SELECT = {
  id: true,
  title: true,
  type: true,
  priority: true,
  dueDate: true,
  status: true,
  progress: true,
} as const;

type LessonCardRow = Prisma.LessonGetPayload<{
  select: typeof LESSON_CARD_SELECT;
}>;

export type WeeklyLessonRow = {
  id: string;
  title: string;
  scheduledAt: Date;
  duration: number;
  status: LessonStatus;
  student: {
    id: string;
    userId: string;
    user: {
      firstName: string | null;
      lastName: string | null;
      image: string | null;
    };
  };
};

export interface WeeklyScheduleDay {
  date: Date;
  /** 0 = domingo. O nome do dia é decisão de quem desenha a tela. */
  weekday: number;
  lessons: Array<{
    id: string;
    title: string;
    start: Date;
    end: Date;
    duration: number;
    status: LessonStatus;
    studentName: string;
    studentId: string;
  }>;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Painel de quem chamou.
   *
   * Uma rota só, com o conteúdo decidido pelo papel — como no resto do portal.
   * O legado tinha `student/dashboard` e `teacher/dashboard` separados, e quem
   * era as duas coisas precisava saber de antemão qual chamar.
   */
  async getDashboard(userId: string, query: DashboardQueryDto) {
    const scope = await this.resolveScope(userId, query.as);

    return scope.role === 'teacher'
      ? this.teacherDashboard(scope.id)
      : this.studentDashboard(scope.id, userId);
  }

  // -------------------------------------------------------------------
  // Painel do aluno
  // -------------------------------------------------------------------

  private async studentDashboard(studentId: string, userId: string) {
    const now = new Date();
    const { startOfToday, endOfToday } = this.dayBounds(now);

    const [
      byStatus,
      upcomingCount,
      studyTime,
      profile,
      upcomingLessons,
      recentLessons,
      assignmentCounts,
      dueSoon,
      studyProgress,
      teachers,
    ] = await Promise.all([
      // Uma agregação no lugar das quatro contagens separadas do legado.
      this.prisma.lesson.groupBy({
        by: ['status'],
        where: { studentId },
        _count: { _all: true },
      }),
      this.prisma.lesson.count({
        where: {
          studentId,
          status: LessonStatus.SCHEDULED,
          scheduledAt: { gte: now },
        },
      }),
      // O legado carregava toda aula concluída só para somar `duration` em
      // memória — um aluno com 200 aulas trazia 200 registros para fazer uma
      // conta que o banco faz sozinho.
      this.prisma.lesson.aggregate({
        where: { studentId, status: LessonStatus.COMPLETED },
        _sum: { duration: true },
      }),
      this.prisma.student.findUnique({
        where: { id: studentId },
        select: {
          currentStreak: true,
          longestStreak: true,
          totalLessonsAttended: true,
          level: true,
          mainInstrument: true,
        },
      }),
      this.prisma.lesson.findMany({
        where: {
          studentId,
          status: LessonStatus.SCHEDULED,
          scheduledAt: { gte: now },
        },
        select: { ...LESSON_CARD_SELECT, teacher: { select: PERSON_SELECT } },
        orderBy: { scheduledAt: 'asc' },
        take: UPCOMING_LIMIT,
      }),
      this.prisma.lesson.findMany({
        where: { studentId, status: LessonStatus.COMPLETED },
        select: {
          ...LESSON_CARD_SELECT,
          lessonSummary: true,
          nextLessonPrep: true,
          skillsWorked: true,
          improvements: true,
          challenges: true,
          studentFeedback: true,
          teacher: { select: PERSON_SELECT },
        },
        orderBy: { scheduledAt: 'desc' },
        take: RECENT_LIMIT,
      }),
      this.assignmentCounts({ studentId }),
      this.prisma.assignment.findMany({
        where: {
          studentId,
          isCompleted: false,
          dueDate: { gte: now },
        },
        select: ASSIGNMENT_CARD_SELECT,
        orderBy: { dueDate: 'asc' },
        take: RECENT_LIMIT,
      }),
      this.studyProgress(userId),
      this.studentTeachers(studentId, now),
    ]);

    const counts = this.countsByStatus(byStatus);
    const attended = counts.completed + counts.noShow;

    return {
      role: 'student' as const,
      generatedAt: now,
      stats: {
        totalLessons: counts.total,
        completedLessons: counts.completed,
        upcomingLessons: upcomingCount,
        missedLessons: counts.noShow,
        cancelledLessons: counts.cancelled,
        studyMinutes: studyTime._sum.duration ?? 0,
        // Só entra aula que já aconteceu. O legado dividia pelo total de
        // aulas, futuras incluídas, então um aluno recém-inscrito com dez
        // aulas marcadas e nenhuma dada aparecia com 100% de presença.
        attendanceRate:
          attended > 0
            ? Math.round((counts.completed / attended) * 1000) / 10
            : null,
        currentStreak: profile?.currentStreak ?? 0,
        longestStreak: profile?.longestStreak ?? 0,
        pendingAssignments: assignmentCounts.pending,
        overdueAssignments: assignmentCounts.overdue,
      },
      profile: {
        level: profile?.level ?? null,
        mainInstrument: profile?.mainInstrument ?? null,
        totalLessonsAttended: profile?.totalLessonsAttended ?? 0,
      },
      todayLessons: upcomingLessons
        .filter(
          (lesson) =>
            lesson.scheduledAt >= startOfToday &&
            lesson.scheduledAt < endOfToday,
        )
        .map((lesson) => this.toLessonCard(lesson, lesson.teacher)),
      upcomingLessons: upcomingLessons.map((lesson) =>
        this.toLessonCard(lesson, lesson.teacher),
      ),
      recentLessons: recentLessons.map((lesson) => ({
        ...this.toLessonCard(lesson, lesson.teacher),
        lessonSummary: lesson.lessonSummary,
        nextLessonPrep: lesson.nextLessonPrep,
        skillsWorked: lesson.skillsWorked,
        improvements: lesson.improvements,
        challenges: lesson.challenges,
        canGiveFeedback: !lesson.studentFeedback,
      })),
      assignmentsDueSoon: dueSoon.map((assignment) => ({
        ...assignment,
        assignmentType: assignment.type,
      })),
      studyProgress,
      teachers,
    };
  }

  /**
   * Professores do aluno, com a próxima aula e o total de cada um.
   *
   * O legado fazia duas consultas **por professor** dentro de um `map`: com
   * cinco professores eram onze idas ao banco. Aqui são três, independentes do
   * número de vínculos.
   */
  private async studentTeachers(studentId: string, now: Date) {
    const relationships = await this.prisma.teacherStudent.findMany({
      where: { studentId, isActive: true },
      select: {
        startDate: true,
        totalLessons: true,
        teacher: {
          select: { ...PERSON_SELECT, specialties: true, instruments: true },
        },
      },
      orderBy: { startDate: 'desc' },
    });

    if (relationships.length === 0) {
      return [];
    }

    const teacherIds = relationships.map((rel) => rel.teacher.id);

    const [nextLessons, totals] = await Promise.all([
      this.prisma.lesson.findMany({
        where: {
          studentId,
          teacherId: { in: teacherIds },
          status: LessonStatus.SCHEDULED,
          scheduledAt: { gte: now },
        },
        select: { teacherId: true, scheduledAt: true },
        orderBy: { scheduledAt: 'asc' },
      }),
      this.prisma.lesson.groupBy({
        by: ['teacherId'],
        where: { studentId, teacherId: { in: teacherIds } },
        _count: { _all: true },
      }),
    ]);

    // A lista vem ordenada, então a primeira ocorrência de cada professor já é
    // a próxima aula dele.
    const nextByTeacher = new Map<string, Date>();
    for (const lesson of nextLessons) {
      if (!nextByTeacher.has(lesson.teacherId)) {
        nextByTeacher.set(lesson.teacherId, lesson.scheduledAt);
      }
    }

    const totalByTeacher = new Map(
      totals.map((row) => [row.teacherId, row._count._all]),
    );

    return relationships.map((rel) => ({
      teacherId: rel.teacher.id,
      userId: rel.teacher.userId,
      name: this.fullName(rel.teacher.user),
      image: rel.teacher.user.image,
      specialties: rel.teacher.specialties,
      instruments: rel.teacher.instruments,
      relationshipStart: rel.startDate,
      nextLessonAt: nextByTeacher.get(rel.teacher.id) ?? null,
      totalLessons: totalByTeacher.get(rel.teacher.id) ?? 0,
    }));
  }

  private async studyProgress(userId: string) {
    const [currentWorks, learnedWorks, recentAnnotations] = await Promise.all([
      this.prisma.wantToLearn.findMany({
        where: { userId },
        select: {
          addedAt: true,
          difficulty: true,
          work: {
            select: {
              id: true,
              title: true,
              composer: { select: { id: true, name: true } },
            },
          },
          selectedWorkScore: { select: { id: true, title: true, type: true } },
        },
        orderBy: { addedAt: 'desc' },
        take: STUDY_LIMIT,
      }),
      this.prisma.learned.findMany({
        where: { userId },
        select: {
          learnedAt: true,
          mastery: true,
          wouldRecommend: true,
          work: {
            select: {
              id: true,
              title: true,
              composer: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { learnedAt: 'desc' },
        take: STUDY_LIMIT,
      }),
      // Sem filtro de `isPublic`: são as anotações do próprio usuário, no
      // painel dele. O legado só mostrava as públicas, então quem anotava em
      // particular — o caso comum — via a seção sempre vazia.
      this.prisma.workAnnotation.findMany({
        where: { userId },
        select: {
          id: true,
          title: true,
          category: true,
          isPublic: true,
          createdAt: true,
          work: { select: { id: true, title: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: RECENT_LIMIT,
      }),
    ]);

    return { currentWorks, learnedWorks, recentAnnotations };
  }

  // -------------------------------------------------------------------
  // Painel do professor
  // -------------------------------------------------------------------

  private async teacherDashboard(teacherId: string) {
    const now = new Date();
    const { startOfToday, endOfToday } = this.dayBounds(now);
    const { startOfWeek, endOfWeek } = this.weekBounds(now);
    const { startOfMonth, endOfMonth } = this.monthBounds(now);
    const recentSince = new Date(now.getTime() - RECENT_ACTIVITY_DAYS * DAY_MS);

    const [
      byStatus,
      pastCount,
      totalStudents,
      studentsWithRecentLessons,
      lessonsThisWeek,
      lessonsThisMonth,
      firstLesson,
      upcomingLessons,
      weeklyLessons,
      students,
      assignmentCounts,
      awaitingFeedback,
    ] = await Promise.all([
      this.prisma.lesson.groupBy({
        by: ['status'],
        where: { teacherId },
        _count: { _all: true },
      }),
      this.prisma.lesson.count({
        where: { teacherId, scheduledAt: { lt: now } },
      }),
      this.prisma.teacherStudent.count({
        where: { teacherId, isActive: true },
      }),
      this.prisma.teacherStudent.count({
        where: {
          teacherId,
          isActive: true,
          // "Recente" é aula que já aconteceu nos últimos 30 dias. O legado
          // aceitava qualquer aula com `scheduledAt` posterior a 30 dias
          // atrás, o que incluía as futuras: bastava ter aula marcada para o
          // mês que vem para o aluno contar como ativo.
          student: {
            is: {
              lessons: {
                some: {
                  teacherId,
                  scheduledAt: { gte: recentSince, lt: now },
                },
              },
            },
          },
        },
      }),
      this.prisma.lesson.count({
        where: { teacherId, scheduledAt: { gte: startOfWeek, lt: endOfWeek } },
      }),
      this.prisma.lesson.count({
        where: {
          teacherId,
          scheduledAt: { gte: startOfMonth, lt: endOfMonth },
        },
      }),
      this.prisma.lesson.findFirst({
        where: { teacherId },
        select: { scheduledAt: true },
        orderBy: { scheduledAt: 'asc' },
      }),
      this.prisma.lesson.findMany({
        where: {
          teacherId,
          status: LessonStatus.SCHEDULED,
          scheduledAt: { gte: now },
        },
        select: {
          ...LESSON_CARD_SELECT,
          student: { select: { ...PERSON_SELECT, level: true } },
        },
        orderBy: { scheduledAt: 'asc' },
        take: UPCOMING_LIMIT,
      }),
      this.prisma.lesson.findMany({
        where: { teacherId, scheduledAt: { gte: startOfWeek, lt: endOfWeek } },
        select: {
          id: true,
          title: true,
          scheduledAt: true,
          duration: true,
          status: true,
          student: { select: PERSON_SELECT },
        },
        orderBy: { scheduledAt: 'asc' },
      }),
      this.teacherStudents(teacherId, now),
      this.assignmentCounts({ lesson: { is: { teacherId } } }),
      // Tarefas entregues esperando o professor: é o que ele precisa fazer
      // hoje, e não existia no painel do legado.
      this.prisma.assignment.findMany({
        where: {
          lesson: { is: { teacherId } },
          isCompleted: true,
          teacherFeedback: null,
        },
        select: {
          ...ASSIGNMENT_CARD_SELECT,
          completedAt: true,
          student: { select: PERSON_SELECT },
        },
        orderBy: { completedAt: 'desc' },
        take: RECENT_LIMIT,
      }),
    ]);

    const counts = this.countsByStatus(byStatus);

    return {
      role: 'teacher' as const,
      generatedAt: now,
      stats: {
        totalStudents,
        studentsWithRecentLessons,
        lessonsThisWeek,
        lessonsThisMonth,
        totalLessons: counts.total,
        completedLessons: counts.completed,
        cancelledLessons: counts.cancelled,
        noShowLessons: counts.noShow,
        // Sobre aula que já passou. Dividir pelo total, como fazia o legado,
        // punia justamente quem tinha muita aula marcada à frente.
        completionRate:
          pastCount > 0
            ? Math.round((counts.completed / pastCount) * 1000) / 10
            : null,
        avgLessonsPerWeek: this.averagePerWeek(
          counts.total,
          firstLesson?.scheduledAt ?? null,
          now,
        ),
        assignmentsPending: assignmentCounts.pending,
        assignmentsOverdue: assignmentCounts.overdue,
        assignmentsAwaitingFeedback: awaitingFeedback.length,
      },
      todayLessons: upcomingLessons
        .filter(
          (lesson) =>
            lesson.scheduledAt >= startOfToday &&
            lesson.scheduledAt < endOfToday,
        )
        .map((lesson) => this.toLessonCard(lesson, lesson.student)),
      upcomingLessons: upcomingLessons.map((lesson) =>
        this.toLessonCard(lesson, lesson.student),
      ),
      weeklySchedule: this.buildWeeklySchedule(startOfWeek, weeklyLessons),
      students,
      assignmentsAwaitingFeedback: awaitingFeedback.map((assignment) => ({
        id: assignment.id,
        title: assignment.title,
        assignmentType: assignment.type,
        priority: assignment.priority,
        completedAt: assignment.completedAt,
        student: {
          id: assignment.student.id,
          userId: assignment.student.userId,
          name: this.fullName(assignment.student.user),
          image: assignment.student.user.image,
        },
      })),
    };
  }

  /**
   * Alunos do professor, com última e próxima aula.
   *
   * Mesmo problema do lado do aluno, em escala maior: o legado rodava duas
   * consultas por aluno dentro de um `map` com teto de 20 — quarenta idas ao
   * banco a cada abertura do painel. Aqui são três, seja qual for o número de
   * alunos.
   */
  private async teacherStudents(teacherId: string, now: Date) {
    const relationships = await this.prisma.teacherStudent.findMany({
      where: { teacherId, isActive: true },
      select: {
        startDate: true,
        totalLessons: true,
        student: {
          select: { ...PERSON_SELECT, level: true, mainInstrument: true },
        },
      },
      orderBy: { startDate: 'desc' },
      take: STUDENTS_LIMIT,
    });

    if (relationships.length === 0) {
      return [];
    }

    const studentIds = relationships.map((rel) => rel.student.id);

    const [schedule, totals] = await Promise.all([
      this.prisma.lesson.findMany({
        where: { teacherId, studentId: { in: studentIds } },
        select: { studentId: true, scheduledAt: true, status: true },
        orderBy: { scheduledAt: 'asc' },
      }),
      this.prisma.lesson.groupBy({
        by: ['studentId'],
        where: { teacherId, studentId: { in: studentIds } },
        _count: { _all: true },
      }),
    ]);

    const nextByStudent = new Map<string, Date>();
    const lastByStudent = new Map<string, Date>();

    for (const lesson of schedule) {
      if (
        lesson.scheduledAt >= now &&
        lesson.status === LessonStatus.SCHEDULED
      ) {
        if (!nextByStudent.has(lesson.studentId)) {
          nextByStudent.set(lesson.studentId, lesson.scheduledAt);
        }
      } else if (lesson.scheduledAt < now) {
        // A lista é crescente, então a última atribuição é a mais recente.
        lastByStudent.set(lesson.studentId, lesson.scheduledAt);
      }
    }

    const totalByStudent = new Map(
      totals.map((row) => [row.studentId, row._count._all]),
    );

    return relationships.map((rel) => ({
      studentId: rel.student.id,
      userId: rel.student.userId,
      name: this.fullName(rel.student.user),
      image: rel.student.user.image,
      level: rel.student.level,
      mainInstrument: rel.student.mainInstrument,
      relationshipStart: rel.startDate,
      nextLessonAt: nextByStudent.get(rel.student.id) ?? null,
      lastLessonAt: lastByStudent.get(rel.student.id) ?? null,
      totalLessons: totalByStudent.get(rel.student.id) ?? 0,
    }));
  }

  /**
   * Agenda da semana, um item por dia.
   *
   * Devolve `Date`, não hora já formatada. O legado chamava
   * `toLocaleTimeString('pt-BR')` dentro da rota, o que fazia o fuso e o
   * idioma do **servidor** entrarem na resposta — o mesmo problema das cores
   * no calendário, com o agravante de que o horário errado é pior que a cor
   * errada.
   */
  private buildWeeklySchedule(
    startOfWeek: Date,
    lessons: WeeklyLessonRow[],
  ): WeeklyScheduleDay[] {
    const days: WeeklyScheduleDay[] = [];

    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(startOfWeek.getTime() + offset * DAY_MS);
      const nextDate = new Date(date.getTime() + DAY_MS);

      days.push({
        date,
        weekday: date.getDay(),
        lessons: lessons
          .filter(
            (lesson) =>
              lesson.scheduledAt >= date && lesson.scheduledAt < nextDate,
          )
          .map((lesson) => ({
            id: lesson.id,
            title: lesson.title,
            start: lesson.scheduledAt,
            end: new Date(
              lesson.scheduledAt.getTime() + lesson.duration * 60_000,
            ),
            duration: lesson.duration,
            status: lesson.status,
            studentName: this.fullName(lesson.student.user),
            studentId: lesson.student.id,
          })),
      });
    }

    return days;
  }

  /**
   * Média de aulas por semana desde a primeira aula.
   *
   * O legado calculava isto:
   *
   * ```
   * allLessons / Math.ceil((Date.now() - teacherProfile.id.length) / semana)
   * ```
   *
   * `teacherProfile.id.length` é o **comprimento da string do id** — 24. O
   * denominador virava "semanas desde 24 milissegundos após 1970", perto de
   * três mil, e a média saía arredondada para `0` em qualquer cenário real.
   * O número aparecia no painel de todo professor desde sempre.
   */
  private averagePerWeek(
    totalLessons: number,
    firstLessonAt: Date | null,
    now: Date,
  ): number | null {
    if (totalLessons === 0 || !firstLessonAt) {
      return null;
    }

    const elapsedWeeks = Math.max(
      1,
      (now.getTime() - firstLessonAt.getTime()) / (7 * DAY_MS),
    );

    return Math.round((totalLessons / elapsedWeeks) * 10) / 10;
  }

  // -------------------------------------------------------------------
  // Auxiliares
  // -------------------------------------------------------------------

  private async assignmentCounts(where: Prisma.AssignmentWhereInput) {
    const now = new Date();

    const [pending, overdue] = await Promise.all([
      this.prisma.assignment.count({
        where: { ...where, isCompleted: false },
      }),
      this.prisma.assignment.count({
        // `not: null`: no MongoDB, `null` ordena antes de qualquer data, e a
        // tarefa sem prazo contaria como atrasada.
        where: {
          ...where,
          isCompleted: false,
          dueDate: { lt: now, not: null },
        },
      }),
    ]);

    return { pending, overdue };
  }

  private countsByStatus(
    rows: Array<{ status: LessonStatus; _count: { _all: number } }>,
  ) {
    const of = (status: LessonStatus) =>
      rows.find((row) => row.status === status)?._count._all ?? 0;

    return {
      total: rows.reduce((sum, row) => sum + row._count._all, 0),
      completed: of(LessonStatus.COMPLETED),
      cancelled: of(LessonStatus.CANCELLED),
      noShow: of(LessonStatus.NO_SHOW),
      scheduled: of(LessonStatus.SCHEDULED),
    };
  }

  private toLessonCard(
    lesson: LessonCardRow,
    counterpart: {
      id: string;
      userId: string;
      user: {
        firstName: string | null;
        lastName: string | null;
        image: string | null;
      };
      level?: string;
    },
  ) {
    return {
      id: lesson.id,
      title: lesson.title,
      scheduledAt: lesson.scheduledAt,
      endsAt: new Date(lesson.scheduledAt.getTime() + lesson.duration * 60_000),
      duration: lesson.duration,
      status: lesson.status,
      location: lesson.location,
      objectives: lesson.objectives,
      homework: lesson.homework,
      publicNotes: lesson.publicNotes,
      counterpart: {
        id: counterpart.id,
        userId: counterpart.userId,
        name: this.fullName(counterpart.user),
        image: counterpart.user.image,
        level: counterpart.level ?? null,
      },
    };
  }

  private fullName(user: {
    firstName: string | null;
    lastName: string | null;
  }) {
    return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  }

  private dayBounds(now: Date) {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    return {
      startOfToday,
      endOfToday: new Date(startOfToday.getTime() + DAY_MS),
    };
  }

  private weekBounds(now: Date) {
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    return {
      startOfWeek,
      endOfWeek: new Date(startOfWeek.getTime() + 7 * DAY_MS),
    };
  }

  /**
   * Limites do mês corrente.
   *
   * O fim é o primeiro instante do mês seguinte, usado com `lt`. O legado
   * montava `new Date(ano, mês + 1, 0)`, que é o **último dia do mês à
   * meia-noite** — e com `lt` isso descartava tudo o que acontecesse no último
   * dia do mês depois das 00h00. A contagem "aulas deste mês" perdia o dia
   * inteiro do fechamento, todo mês.
   */
  private monthBounds(now: Date) {
    return {
      startOfMonth: new Date(now.getFullYear(), now.getMonth(), 1),
      endOfMonth: new Date(now.getFullYear(), now.getMonth() + 1, 1),
    };
  }

  private async resolveScope(userId: string, as?: 'teacher' | 'student') {
    if (as !== 'student') {
      const teacher = await this.prisma.teacher.findUnique({
        where: { userId },
        select: { id: true },
      });

      if (teacher) {
        return { role: 'teacher' as const, id: teacher.id };
      }

      if (as === 'teacher') {
        throw new ForbiddenException('Você não tem perfil de professor');
      }
    }

    const student = await this.prisma.student.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!student) {
      throw new ForbiddenException('Você não tem perfil de aluno');
    }

    return { role: 'student' as const, id: student.id };
  }
}
