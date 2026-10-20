import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SchoolActivityAction } from '@prisma/client';
import { localDate } from '../../common/utils/time-zone';
import { PrismaService } from '../../prisma/prisma.service';
import { SchoolActivitiesService } from '../school-activities/school-activities.service';
import {
  LogPracticeDto,
  PracticeGoalDto,
  PracticeQueryDto,
} from './dto/practice.dto';

const DAY_MS = 86_400_000;
/** O dia da prática conta no fuso do Brasil até o aluno ter fuso próprio. */
const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';
/** Mais que isto numa consulta é relatório, não diário. */
const MAX_RANGE_DAYS = 366;

/**
 * Diário de prática do aluno (04/10/2026).
 *
 * O aluno registra quanto estudou e o quê; o professor lê a semana do aluno
 * antes da aula. É o dado que faltava para o "praticou abaixo da meta" do
 * painel e para a prática nos relatórios — antes o portal só tinha o campo
 * `practiceTime` (a meta) e nenhum registro do que de fato aconteceu.
 */
@Injectable()
export class PracticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activities: SchoolActivitiesService,
  ) {}

  async log(userId: string, dto: LogPracticeDto) {
    const student = await this.requireStudent(userId);
    const practicedAt = dto.practicedAt
      ? new Date(dto.practicedAt)
      : new Date();

    // Registro no futuro não é prática, é engano de relógio.
    if (practicedAt.getTime() > Date.now() + 5 * 60_000) {
      throw new BadRequestException('Não dá para registrar prática no futuro');
    }

    const entry = await this.prisma.practiceLog.create({
      data: {
        studentId: student.id,
        practicedAt,
        minutes: dto.minutes,
        workId: dto.workId,
        topic: dto.topic?.trim() || null,
        note: dto.note?.trim() || null,
      },
      select: {
        id: true,
        practicedAt: true,
        minutes: true,
        workId: true,
        topic: true,
        note: true,
      },
    });

    await this.activities.record({
      userId,
      userType: 'student',
      action: SchoolActivityAction.PRACTICE_LOGGED,
      entityType: 'practice',
      entityId: entry.id,
      entityName: dto.topic ?? 'Prática',
      title: `Registrou ${dto.minutes} min de prática`,
      description: dto.topic ?? undefined,
      metadata: { minutes: dto.minutes, workId: dto.workId ?? null },
    });

    return entry;
  }

  async remove(userId: string, id: string) {
    const student = await this.requireStudent(userId);
    const entry = await this.prisma.practiceLog.findFirst({
      where: { id, studentId: student.id },
      select: { minutes: true, topic: true },
    });
    if (!entry) throw new NotFoundException('Registro não encontrado');
    await this.prisma.practiceLog.delete({ where: { id } });

    await this.activities.record({
      userId,
      userType: 'student',
      action: SchoolActivityAction.PRACTICE_REMOVED,
      entityType: 'practice',
      entityId: id,
      entityName: entry.topic ?? 'Prática',
      title: `Apagou um registro de ${entry.minutes} min de prática`,
      description: entry.topic ?? undefined,
    });
  }

  async setGoal(userId: string, dto: PracticeGoalDto) {
    const student = await this.requireStudent(userId);
    await this.prisma.student.update({
      where: { id: student.id },
      data: { practiceTime: dto.weeklyMinutes || null },
    });

    await this.activities.record({
      userId,
      userType: 'student',
      action: SchoolActivityAction.PRACTICE_GOAL_SET,
      entityType: 'practice',
      title: dto.weeklyMinutes
        ? `Definiu a meta de prática: ${dto.weeklyMinutes} min por semana`
        : 'Tirou a meta de prática',
    });
    return { weeklyMinutes: dto.weeklyMinutes };
  }

  /**
   * O diário de um período, com a soma por dia e por obra/assunto.
   *
   * Sem `studentId`, o próprio aluno. Com `studentId`, só o professor dele —
   * inclusive depois de encerrado o vínculo, porque o histórico é dos dois.
   */
  async list(userId: string, query: PracticeQueryDto) {
    const studentId = query.studentId
      ? await this.requireTeacherOf(userId, query.studentId)
      : (await this.requireStudent(userId)).id;

    const to = query.to ? new Date(query.to) : new Date(Date.now() + DAY_MS);
    const requestedFrom = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - 28 * DAY_MS);
    const from =
      to.getTime() - requestedFrom.getTime() > MAX_RANGE_DAYS * DAY_MS
        ? new Date(to.getTime() - MAX_RANGE_DAYS * DAY_MS)
        : requestedFrom;

    const [entries, student] = await Promise.all([
      this.prisma.practiceLog.findMany({
        where: { studentId, practicedAt: { gte: from, lt: to } },
        select: {
          id: true,
          practicedAt: true,
          minutes: true,
          workId: true,
          topic: true,
          note: true,
        },
        orderBy: { practicedAt: 'desc' },
        take: 1000,
      }),
      this.prisma.student.findUnique({
        where: { id: studentId },
        select: { practiceTime: true },
      }),
    ]);

    const works = await this.workTitles(
      entries.map((e) => e.workId).filter((id): id is string => !!id),
    );
    const byDay = new Map<string, number>();
    const bySubject = new Map<string, number>();
    for (const entry of entries) {
      const day = localDate(entry.practicedAt, DEFAULT_TIME_ZONE);
      byDay.set(day, (byDay.get(day) ?? 0) + entry.minutes);
      const subject = entry.workId
        ? (works.get(entry.workId)?.title ?? 'Obra')
        : (entry.topic ?? 'Outros');
      bySubject.set(subject, (bySubject.get(subject) ?? 0) + entry.minutes);
    }

    return {
      from,
      to,
      weeklyGoalMinutes: student?.practiceTime ?? null,
      totalMinutes: entries.reduce((sum, e) => sum + e.minutes, 0),
      days: [...byDay.entries()]
        .map(([date, minutes]) => ({ date, minutes }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      subjects: [...bySubject.entries()]
        .map(([subject, minutes]) => ({ subject, minutes }))
        .sort((a, b) => b.minutes - a.minutes),
      entries: entries.map((e) => ({
        ...e,
        work: e.workId ? (works.get(e.workId) ?? null) : null,
      })),
    };
  }

  /**
   * Soma da prática de vários alunos numa janela — o painel do professor usa
   * para "praticou abaixo da meta" sem uma consulta por aluno.
   */
  async totalsFor(
    studentIds: string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, number>> {
    if (studentIds.length === 0) return new Map();
    const rows = await this.prisma.practiceLog.groupBy({
      by: ['studentId'],
      where: {
        studentId: { in: studentIds },
        practicedAt: { gte: from, lt: to },
      },
      _sum: { minutes: true },
    });
    return new Map(rows.map((r) => [r.studentId, r._sum.minutes ?? 0]));
  }

  private async workTitles(ids: string[]) {
    if (ids.length === 0)
      return new Map<
        string,
        { id: string; title: string; composer: string | null }
      >();
    const works = await this.prisma.work.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, title: true, composer: { select: { name: true } } },
    });
    return new Map(
      works.map((w) => [
        w.id,
        { id: w.id, title: w.title, composer: w.composer?.name ?? null },
      ]),
    );
  }

  private async requireStudent(userId: string) {
    const student = await this.prisma.student.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!student) throw new ForbiddenException('Você não tem perfil de aluno');
    return student;
  }

  /** Devolve o Student.id se quem chama é (ou foi) professor dele. */
  private async requireTeacherOf(userId: string, studentId: string) {
    const link = await this.prisma.teacherStudent.findFirst({
      where: { studentId, teacher: { is: { userId } } },
      select: { studentId: true },
    });
    if (!link) throw new NotFoundException('Aluno não encontrado');
    return link.studentId;
  }
}
