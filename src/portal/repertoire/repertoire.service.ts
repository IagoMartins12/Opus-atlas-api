import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LessonStatus,
  NotificationPriority,
  NotificationType,
  SchoolActivityAction,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SchoolActivitiesService } from '../school-activities/school-activities.service';
import { SuggestWorkDto } from './dto/repertoire.dto';

const DAY_MS = 86_400_000;
const WORK_SELECT = {
  id: true,
  title: true,
  composer: { select: { id: true, name: true } },
} as const;
const SCORE_SELECT = {
  id: true,
  title: true,
  type: true,
  source: true,
} as const;

/**
 * Repertório do aluno — a ponte entre o portal e a biblioteca (04/10/2026).
 *
 * Três listas: **estudando** (as obras das aulas e tarefas em curso),
 * **quero aprender** e **já aprendi** (as mesmas da biblioteca do Opus Atlas,
 * `WantToLearn` e `Learned`). O aluno vê o próprio; o professor vê o dos
 * alunos dele — se o aluno permitir (`allowProgressShare`) — e sugere obras,
 * que entram no "quero aprender" com o nome de quem sugeriu.
 */
@Injectable()
export class RepertoireService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly activities: SchoolActivitiesService,
  ) {}

  async mine(userId: string) {
    const student = await this.prisma.student.findUnique({
      where: { userId },
      select: { id: true, userId: true },
    });
    if (!student) throw new ForbiddenException('Você não tem perfil de aluno');
    return this.of(student.id, student.userId);
  }

  async ofStudent(teacherUserId: string, studentId: string) {
    const link = await this.requireTeacherOf(teacherUserId, studentId);
    if (!link.student.allowProgressShare) {
      throw new ForbiddenException(
        'Este aluno não compartilha o repertório com os professores',
      );
    }
    return this.of(studentId, link.student.userId, link.teacherId);
  }

  async suggest(teacherUserId: string, studentId: string, dto: SuggestWorkDto) {
    const link = await this.requireTeacherOf(teacherUserId, studentId, true);
    const work = await this.prisma.work.findUnique({
      where: { id: dto.workId },
      select: { id: true, title: true },
    });
    if (!work) throw new NotFoundException('Obra não encontrada');
    if (dto.workScoreId) {
      const score = await this.prisma.workScore.findFirst({
        where: { id: dto.workScoreId, workId: work.id },
        select: { id: true },
      });
      if (!score)
        throw new NotFoundException('Partitura não encontrada nesta obra');
    }

    // Já na lista: não duplica nem tira a escolha do aluno — só registra quem sugeriu.
    const item = await this.prisma.wantToLearn.upsert({
      where: {
        userId_workId: { userId: link.student.userId, workId: work.id },
      },
      create: {
        userId: link.student.userId,
        workId: work.id,
        suggestedByUserId: teacherUserId,
        selectedWorkScoreId: dto.workScoreId,
        notes: dto.note?.trim() || null,
      },
      update: { suggestedByUserId: teacherUserId },
      select: { id: true, addedAt: true },
    });

    const teacherName = [
      link.teacher.user.firstName,
      link.teacher.user.lastName,
    ]
      .filter(Boolean)
      .join(' ')
      .trim();
    await this.notifications.notify({
      userId: link.student.userId,
      type: NotificationType.WORK_SUGGESTED,
      priority: NotificationPriority.LOW,
      title: 'Obra sugerida',
      message: `${teacherName || 'Seu professor'} sugeriu "${work.title}" para o seu "quero aprender".`,
      actionText: 'Ver no estudo',
      actionUrl: '/student/study',
      relatedEntityType: 'work',
      relatedEntityId: work.id,
    });
    await this.activities.record({
      userId: teacherUserId,
      userType: 'teacher',
      action: SchoolActivityAction.WORK_SUGGESTED,
      entityType: 'work',
      entityId: work.id,
      entityName: work.title,
      title: `Sugeriu "${work.title}"`,
      metadata: { studentId },
    });

    return item;
  }

  private async of(
    studentId: string,
    studentUserId: string,
    teacherId?: string,
  ) {
    const now = Date.now();
    const [lessons, assignments, want, learned] = await Promise.all([
      this.prisma.lesson.findMany({
        where: {
          studentId,
          ...(teacherId ? { teacherId } : {}),
          status: { in: [LessonStatus.SCHEDULED, LessonStatus.COMPLETED] },
          scheduledAt: {
            gte: new Date(now - 45 * DAY_MS),
            lt: new Date(now + 60 * DAY_MS),
          },
          worksIds: { isEmpty: false },
        },
        select: {
          id: true,
          scheduledAt: true,
          worksIds: true,
          repertoire: true,
        },
        orderBy: { scheduledAt: 'desc' },
        take: 100,
      }),
      this.prisma.assignment.findMany({
        where: {
          studentId,
          isCompleted: false,
          worksIds: { isEmpty: false },
          ...(teacherId ? { lesson: { is: { teacherId } } } : {}),
        },
        select: { id: true, title: true, worksIds: true, dueDate: true },
        take: 50,
      }),
      this.prisma.wantToLearn.findMany({
        where: { userId: studentUserId },
        select: {
          id: true,
          addedAt: true,
          notes: true,
          priority: true,
          suggestedByUserId: true,
          work: { select: WORK_SELECT },
          selectedWorkScore: { select: SCORE_SELECT },
        },
        orderBy: [{ priority: 'desc' }, { addedAt: 'desc' }],
        take: 100,
      }),
      this.prisma.learned.findMany({
        where: { userId: studentUserId },
        select: {
          id: true,
          learnedAt: true,
          mastery: true,
          wouldRecommend: true,
          work: { select: WORK_SELECT },
          selectedWorkScore: { select: SCORE_SELECT },
        },
        orderBy: { learnedAt: 'desc' },
        take: 100,
      }),
    ]);

    // Estudando: cada obra uma vez, com a origem mais recente.
    const sources = new Map<
      string,
      { since: Date; lessonId?: string; assignmentId?: string }
    >();
    for (const lesson of lessons) {
      for (const workId of lesson.worksIds) {
        const current = sources.get(workId);
        if (!current || current.since > lesson.scheduledAt)
          sources.set(workId, {
            since: lesson.scheduledAt,
            lessonId: lesson.id,
          });
      }
    }
    for (const assignment of assignments) {
      for (const workId of assignment.worksIds) {
        if (!sources.has(workId))
          sources.set(workId, {
            since: assignment.dueDate ?? new Date(),
            assignmentId: assignment.id,
          });
      }
    }
    const studyingWorks = sources.size
      ? await this.prisma.work.findMany({
          where: { id: { in: [...sources.keys()] } },
          select: WORK_SELECT,
        })
      : [];
    const suggesters = await this.namesOf(
      want.map((w) => w.suggestedByUserId).filter((id): id is string => !!id),
    );

    return {
      studying: studyingWorks.map((work) => ({
        work,
        ...sources.get(work.id)!,
      })),
      wantToLearn: want.map((w) => ({
        id: w.id,
        addedAt: w.addedAt,
        notes: w.notes,
        work: w.work,
        score: w.selectedWorkScore,
        suggestedBy: w.suggestedByUserId
          ? (suggesters.get(w.suggestedByUserId) ?? null)
          : null,
      })),
      learned: learned.map((l) => ({
        id: l.id,
        learnedAt: l.learnedAt,
        mastery: l.mastery,
        wouldRecommend: l.wouldRecommend,
        work: l.work,
        score: l.selectedWorkScore,
      })),
    };
  }

  private async namesOf(userIds: string[]) {
    if (userIds.length === 0) return new Map<string, string>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(
      users.map((u) => [
        u.id,
        [u.firstName, u.lastName].filter(Boolean).join(' ').trim(),
      ]),
    );
  }

  /** O vínculo do professor com o aluno; `active` exige vínculo vigente. */
  private async requireTeacherOf(
    teacherUserId: string,
    studentId: string,
    active = false,
  ) {
    const link = await this.prisma.teacherStudent.findFirst({
      where: {
        studentId,
        teacher: { is: { userId: teacherUserId } },
        ...(active
          ? { isActive: true, inviteStatus: 'ACCEPTED' as const }
          : {}),
      },
      select: {
        teacherId: true,
        teacher: {
          select: { user: { select: { firstName: true, lastName: true } } },
        },
        student: { select: { userId: true, allowProgressShare: true } },
      },
    });
    if (!link) throw new NotFoundException('Aluno não encontrado');
    return link;
  }
}
