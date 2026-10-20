import { Injectable, NotFoundException } from '@nestjs/common';
import { LessonStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  checkOccurrence,
  suggestSlots,
  worstSeverity,
  type BusyLesson,
  type CheckContext,
  type Finding,
  type FindingSeverity,
} from './schedule-rules';

/** Nenhuma aula passa de 8 horas: é o quanto a janela recua para trás. */
const MAX_LESSON_MINUTES = 480;
const DAY_MS = 86_400_000;
/** Até onde as sugestões procuram depois da ocorrência. */
const SUGGESTION_DAYS = 14;

export interface OccurrenceResult {
  scheduledAt: Date;
  severity: FindingSeverity | 'ok';
  findings: Finding[];
  /** Horários limpos perto desta ocorrência — só quando ela tem problema. */
  suggestions: Date[];
}

export interface ScheduleCheck {
  severity: FindingSeverity | 'ok';
  occurrences: OccurrenceResult[];
  summary: { blocking: number; conflicts: number; warnings: number };
}

const fullName = (
  u: { firstName: string | null; lastName: string | null } | null | undefined,
) =>
  u ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || null : null;

/**
 * Carrega o que as regras de agenda precisam e confere cada ocorrência.
 *
 * **Uma leva de consultas para a série inteira.** A verificação antiga fazia
 * uma consulta por ocorrência (uma série semanal de seis meses eram 26 idas ao
 * banco, mais uma por sugestão). Aqui são quatro, seja qual for o tamanho da
 * série: o professor com agenda e bloqueios, o vínculo com o plano do aluno,
 * e as aulas do professor e do aluno — em **qualquer** turma — na janela
 * que cobre as semanas da série mais o horizonte das sugestões.
 */
@Injectable()
export class ScheduleRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async check(params: {
    teacherId: string;
    studentId: string;
    occurrences: Date[];
    duration: number;
    location: string | null;
    excludeLessonId?: string;
    now?: Date;
  }): Promise<ScheduleCheck> {
    const ctx = await this.loadContext(params);
    const occurrences = params.occurrences.map((scheduledAt) => {
      const findings = checkOccurrence(
        { scheduledAt, duration: params.duration, location: params.location },
        ctx,
      );
      const severity = worstSeverity(findings);
      const suggestions =
        severity === 'conflict' ||
        severity === 'blocking' ||
        (severity === 'warning' && params.occurrences.length === 1)
          ? suggestSlots(
              { duration: params.duration, location: params.location },
              ctx,
              scheduledAt,
              {
                limit: params.occurrences.length === 1 ? 4 : 1,
              },
            )
          : [];
      return { scheduledAt, severity, findings, suggestions };
    });

    const all = occurrences.flatMap((o) => o.findings);
    return {
      severity: worstSeverity(all),
      occurrences,
      summary: {
        blocking: occurrences.filter((o) => o.severity === 'blocking').length,
        conflicts: occurrences.filter((o) => o.severity === 'conflict').length,
        warnings: occurrences.filter((o) => o.severity === 'warning').length,
      },
    };
  }

  /** O contexto das regras — exposto para as sugestões avulsas (pedidos de aula). */
  async loadContext(params: {
    teacherId: string;
    studentId: string;
    occurrences: Date[];
    excludeLessonId?: string;
    now?: Date;
  }): Promise<CheckContext> {
    const now = params.now ?? new Date();
    const times = params.occurrences.map((d) => d.getTime());
    const from = new Date(
      Math.min(...times) - 7 * DAY_MS - MAX_LESSON_MINUTES * 60_000,
    );
    const to = new Date(Math.max(...times) + (7 + SUGGESTION_DAYS) * DAY_MS);

    const [teacher, relationship, lessons] = await Promise.all([
      this.prisma.teacher.findUnique({
        where: { id: params.teacherId },
        select: {
          id: true,
          timezone: true,
          bufferMinutes: true,
          travelMinutes: true,
          maxLessonsPerDay: true,
          maxLessonsPerWeek: true,
          availability: {
            select: { weekday: true, startTime: true, endTime: true },
          },
          availabilityBlocks: {
            where: { endsAt: { gt: from }, startsAt: { lt: to } },
            select: { startsAt: true, endsAt: true, reason: true },
          },
        },
      }),
      this.prisma.teacherStudent.findFirst({
        where: { teacherId: params.teacherId, studentId: params.studentId },
        select: {
          maxLessonsPerWeek: true,
          preferredDays: true,
          student: {
            select: { user: { select: { firstName: true, lastName: true } } },
          },
        },
      }),
      this.prisma.lesson.findMany({
        where: {
          status: LessonStatus.SCHEDULED,
          scheduledAt: { gte: from, lt: to },
          OR: [
            { teacherId: params.teacherId },
            { studentId: params.studentId },
          ],
        },
        select: {
          id: true,
          title: true,
          scheduledAt: true,
          duration: true,
          location: true,
          teacherId: true,
          studentId: true,
          student: {
            select: { user: { select: { firstName: true, lastName: true } } },
          },
          teacher: {
            select: { user: { select: { firstName: true, lastName: true } } },
          },
        },
      }),
    ]);

    if (!teacher) throw new NotFoundException('Professor não encontrado');

    const busy: BusyLesson[] = lessons.map((l) => ({
      id: l.id,
      title: l.title,
      scheduledAt: l.scheduledAt,
      duration: l.duration,
      location: l.location,
      teacherId: l.teacherId,
      studentId: l.studentId,
      studentName: fullName(l.student?.user)?.split(' ')[0] ?? null,
      teacherName: fullName(l.teacher?.user),
    }));

    return {
      now,
      excludeLessonId: params.excludeLessonId,
      busy,
      rules: {
        teacherId: teacher.id,
        timeZone: teacher.timezone,
        bufferMinutes: teacher.bufferMinutes,
        travelMinutes: teacher.travelMinutes,
        maxLessonsPerDay: teacher.maxLessonsPerDay,
        maxLessonsPerWeek: teacher.maxLessonsPerWeek,
        weekly: teacher.availability,
        blocks: teacher.availabilityBlocks.map((b) => ({
          start: b.startsAt,
          end: b.endsAt,
          reason: b.reason,
        })),
      },
      plan: {
        studentId: params.studentId,
        studentName:
          fullName(relationship?.student.user)?.split(' ')[0] ?? 'O aluno',
        // Aviso, nunca bloqueio: uma aula extra antes de prova é comum.
        maxLessonsPerWeek: relationship?.maxLessonsPerWeek ?? null,
        preferredDays: relationship?.preferredDays ?? [],
      },
    };
  }
}
