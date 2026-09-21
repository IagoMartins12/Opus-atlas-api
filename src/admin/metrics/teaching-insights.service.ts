import { Injectable } from '@nestjs/common';
import { LessonStatus, StudentInviteStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { buildInsight, Insight, percent } from './insight';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Além disto, tarefa entregue esperando resposta vira problema de serviço. */
const FEEDBACK_SLA_DAYS = 7;

/** Janela para considerar que o aluno tem aula à frente. */
const UPCOMING_WINDOW_DAYS = 30;

const EVIDENCE = 20;

@Injectable()
export class TeachingInsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async collect(): Promise<Insight[]> {
    const [orphans, feedback, pending, attendance] = await Promise.all([
      this.studentsWithoutUpcomingLesson(),
      this.assignmentsAwaitingFeedback(),
      this.lessonsPendingClosure(),
      this.attendanceHealth(),
    ]);

    return [orphans, feedback, pending, attendance];
  }

  /**
   * Alunos vinculados e sem nenhuma aula marcada.
   *
   * É o sinal de evasão mais direto que existe no portal: o vínculo está ativo,
   * o aluno aceitou o convite, e não há próximo encontro na agenda. Cada nome
   * aqui é um professor a avisar hoje.
   */
  private async studentsWithoutUpcomingLesson(): Promise<Insight> {
    const now = new Date();
    const horizon = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * DAY_MS);

    const relationships = await this.prisma.teacherStudent.findMany({
      where: {
        isActive: true,
        inviteStatus: StudentInviteStatus.ACCEPTED,
      },
      select: {
        studentId: true,
        teacherId: true,
        startDate: true,
        student: {
          select: {
            id: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
        teacher: {
          select: {
            id: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    if (relationships.length === 0) {
      return buildInsight({
        code: 'teaching.students_without_upcoming_lesson',
        title: 'Alunos vinculados sem aula marcada',
        severity: 'healthy',
        detail: 'Não há vínculos ativos.',
        value: 0,
        unit: 'count',
        sampleSize: 0,
        minimumSample: 3,
      });
    }

    // Uma consulta para todas as próximas aulas, em vez de uma por vínculo.
    const upcoming = await this.prisma.lesson.findMany({
      where: {
        status: LessonStatus.SCHEDULED,
        scheduledAt: { gte: now, lte: horizon },
        studentId: { in: relationships.map((rel) => rel.studentId) },
      },
      select: { studentId: true, teacherId: true },
    });

    const withLesson = new Set(
      upcoming.map((lesson) => `${lesson.teacherId}:${lesson.studentId}`),
    );

    const orphans = relationships.filter(
      (rel) => !withLesson.has(`${rel.teacherId}:${rel.studentId}`),
    );

    const share = percent(orphans.length, relationships.length) ?? 0;

    return buildInsight({
      code: 'teaching.students_without_upcoming_lesson',
      title: 'Alunos vinculados sem aula marcada',
      severity: share > 40 ? 'critical' : share > 15 ? 'warning' : 'healthy',
      detail: `${orphans.length} de ${relationships.length} vínculos ativos não têm aula nos próximos ${UPCOMING_WINDOW_DAYS} dias.`,
      value: share,
      unit: 'percent',
      sampleSize: relationships.length,
      minimumSample: 3,
      action:
        orphans.length > 0
          ? 'Avisar os professores destes vínculos antes que o aluno se desligue sozinho.'
          : undefined,
      evidence: orphans.slice(0, EVIDENCE).map((rel) => ({
        aluno: this.name(rel.student.user),
        professor: this.name(rel.teacher.user),
        vinculoDesde: rel.startDate,
      })),
    });
  }

  /**
   * Tarefas entregues e ainda sem resposta do professor.
   *
   * O aluno cumpriu a parte dele. Quanto mais tempo passa, menos o retorno
   * serve — e o dado existe: `completedAt` marca a entrega e
   * `teacherFeedback` marca a resposta.
   */
  private async assignmentsAwaitingFeedback(): Promise<Insight> {
    const cutoff = new Date(Date.now() - FEEDBACK_SLA_DAYS * DAY_MS);

    const [atrasadas, entregues, exemplos] = await Promise.all([
      this.prisma.assignment.count({
        where: {
          isCompleted: true,
          teacherFeedback: null,
          completedAt: { lt: cutoff },
        },
      }),
      this.prisma.assignment.count({ where: { isCompleted: true } }),
      this.prisma.assignment.findMany({
        where: {
          isCompleted: true,
          teacherFeedback: null,
          completedAt: { lt: cutoff },
        },
        select: {
          id: true,
          title: true,
          completedAt: true,
          student: {
            select: { user: { select: { firstName: true, lastName: true } } },
          },
          lesson: {
            select: {
              teacher: {
                select: {
                  user: { select: { firstName: true, lastName: true } },
                },
              },
            },
          },
        },
        orderBy: { completedAt: 'asc' },
        take: EVIDENCE,
      }),
    ]);

    const share = percent(atrasadas, entregues) ?? 0;

    return buildInsight({
      code: 'teaching.assignments_awaiting_feedback',
      title: `Tarefas entregues sem resposta há mais de ${FEEDBACK_SLA_DAYS} dias`,
      severity: share > 30 ? 'critical' : share > 10 ? 'warning' : 'healthy',
      detail: `${atrasadas} de ${entregues} tarefas concluídas seguem sem feedback do professor além do prazo.`,
      value: share,
      unit: 'percent',
      sampleSize: entregues,
      minimumSample: 3,
      action:
        atrasadas > 0
          ? 'Cobrar os professores da lista — o aluno já fez a parte dele.'
          : undefined,
      evidence: exemplos.map((assignment) => ({
        tarefa: assignment.title,
        aluno: this.name(assignment.student.user),
        professor: this.name(assignment.lesson.teacher.user),
        entregueEm: assignment.completedAt,
        diasEsperando: assignment.completedAt
          ? Math.floor((Date.now() - assignment.completedAt.getTime()) / DAY_MS)
          : null,
      })),
    });
  }

  /**
   * Aulas que já aconteceram e continuam como agendadas.
   *
   * Enquanto o professor não fecha a aula, ela não entra em nenhuma
   * estatística: presença, histórico e relatório de progresso ficam todos
   * defasados por causa de um clique que faltou.
   */
  private async lessonsPendingClosure(): Promise<Insight> {
    const now = new Date();
    const floor = new Date(now.getTime() - 90 * DAY_MS);

    const [pendentes, passadas, exemplos] = await Promise.all([
      this.prisma.lesson.count({
        where: {
          status: LessonStatus.SCHEDULED,
          scheduledAt: { gte: floor, lt: now },
        },
      }),
      this.prisma.lesson.count({
        where: { scheduledAt: { gte: floor, lt: now } },
      }),
      this.prisma.lesson.findMany({
        where: {
          status: LessonStatus.SCHEDULED,
          scheduledAt: { gte: floor, lt: now },
        },
        select: {
          id: true,
          title: true,
          scheduledAt: true,
          teacher: {
            select: { user: { select: { firstName: true, lastName: true } } },
          },
        },
        orderBy: { scheduledAt: 'asc' },
        take: EVIDENCE,
      }),
    ]);

    const share = percent(pendentes, passadas) ?? 0;

    return buildInsight({
      code: 'teaching.lessons_pending_closure',
      title: 'Aulas passadas ainda sem status',
      severity: share > 30 ? 'warning' : share > 10 ? 'opportunity' : 'healthy',
      detail: `${pendentes} de ${passadas} aulas dos últimos 90 dias seguem marcadas como agendadas. Enquanto não são fechadas, não entram em nenhuma estatística.`,
      value: share,
      unit: 'percent',
      sampleSize: passadas,
      minimumSample: 5,
      action:
        pendentes > 0
          ? 'Lembrar os professores de fechar as aulas; sem isso os relatórios ficam defasados.'
          : undefined,
      evidence: exemplos.map((lesson) => ({
        aula: lesson.title,
        professor: this.name(lesson.teacher.user),
        aconteceuEm: lesson.scheduledAt,
      })),
    });
  }

  /** Presença agregada, contando só aula que já aconteceu. */
  private async attendanceHealth(): Promise<Insight> {
    const [concluidas, faltas] = await Promise.all([
      this.prisma.lesson.count({ where: { status: LessonStatus.COMPLETED } }),
      this.prisma.lesson.count({ where: { status: LessonStatus.NO_SHOW } }),
    ]);

    const base = concluidas + faltas;
    const rate = percent(concluidas, base);

    return buildInsight({
      code: 'teaching.attendance_health',
      title: 'Presença geral nas aulas',
      severity:
        rate === null
          ? 'healthy'
          : rate < 70
            ? 'warning'
            : rate < 85
              ? 'opportunity'
              : 'healthy',
      detail: `${concluidas} aulas concluídas e ${faltas} faltas. A taxa considera só aula que já aconteceu — agendada não entra.`,
      value: rate,
      unit: 'percent',
      sampleSize: base,
      minimumSample: 10,
      evidence: [{ concluidas, faltas }],
    });
  }

  private name(user: { firstName: string | null; lastName: string | null }) {
    return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  }
}
