import { Injectable } from '@nestjs/common';
import { LessonStatus, RecurrenceType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Maior duração aceita para uma aula, em minutos.
 *
 * Usada para limitar a janela de busca de conflitos: uma aula que começou há
 * mais de 8 horas não pode se sobrepor à que estamos agendando.
 */
const MAX_LESSON_MINUTES = 480;

/** Teto da série recorrente, para não gerar aulas indefinidamente. */
const MAX_RECURRENCE_MONTHS = 6;
const MAX_OCCURRENCES = 60;

export interface LessonConflict {
  lessonId: string;
  title: string;
  scheduledAt: Date;
  duration: number;
  /** Quem está ocupado: o professor, o aluno, ou os dois. */
  clashesWith: 'teacher' | 'student' | 'both';
  studentName: string | null;
}

@Injectable()
export class LessonSchedulingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Procura aulas que se sobrepõem ao intervalo pedido.
   *
   * Três correções sobre a implementação do legado:
   *
   * 1. **A janela de busca tem limite inferior.** Antes a consulta filtrava só
   *    `scheduledAt < fim`, sem piso, então carregava todas as aulas já dadas
   *    pelo professor desde sempre e filtrava em memória. Um professor com dois
   *    anos de histórico pagava isso a cada verificação. Como nenhuma aula passa
   *    de 8 horas, basta olhar a partir de `início − 8h`.
   * 2. **O aluno também é verificado.** O legado só checava o professor, então
   *    dois professores diferentes podiam agendar com o mesmo aluno no mesmo
   *    horário sem que nada acusasse.
   * 3. **A sobreposição é calculada com o fim real de cada aula**, somando a
   *    duração — comparar só os horários de início deixaria passar uma aula de
   *    60 minutos que começou 30 minutos antes.
   */
  async findConflicts(params: {
    teacherId: string;
    studentId: string;
    scheduledAt: Date;
    duration: number;
    excludeLessonId?: string;
  }): Promise<LessonConflict[]> {
    const start = params.scheduledAt;
    const end = new Date(start.getTime() + params.duration * 60_000);

    // Piso da janela: nenhuma aula iniciada antes disso pode alcançar `start`.
    const earliestPossibleStart = new Date(
      start.getTime() - MAX_LESSON_MINUTES * 60_000,
    );

    const candidates = await this.prisma.lesson.findMany({
      where: {
        status: LessonStatus.SCHEDULED,
        scheduledAt: { gte: earliestPossibleStart, lt: end },
        ...(params.excludeLessonId
          ? { id: { not: params.excludeLessonId } }
          : {}),
        OR: [{ teacherId: params.teacherId }, { studentId: params.studentId }],
      },
      select: {
        id: true,
        title: true,
        scheduledAt: true,
        duration: true,
        teacherId: true,
        studentId: true,
        student: {
          select: { user: { select: { firstName: true, lastName: true } } },
        },
      },
    });

    return candidates
      .filter((lesson) => {
        const lessonStart = lesson.scheduledAt;
        const lessonEnd = new Date(
          lessonStart.getTime() + lesson.duration * 60_000,
        );

        // Sobreposição real: começa antes de o outro terminar e termina depois
        // de o outro começar.
        return start < lessonEnd && end > lessonStart;
      })
      .map((lesson) => {
        const teacherClash = lesson.teacherId === params.teacherId;
        const studentClash = lesson.studentId === params.studentId;

        return {
          lessonId: lesson.id,
          title: lesson.title,
          scheduledAt: lesson.scheduledAt,
          duration: lesson.duration,
          clashesWith:
            teacherClash && studentClash
              ? ('both' as const)
              : teacherClash
                ? ('teacher' as const)
                : ('student' as const),
          studentName:
            [lesson.student.user.firstName, lesson.student.user.lastName]
              .filter(Boolean)
              .join(' ')
              .trim() || null,
        };
      });
  }

  /**
   * Datas de uma série recorrente.
   *
   * Dois tetos independentes: 6 meses de horizonte e 60 ocorrências. O primeiro
   * evita uma série que nunca termina; o segundo protege de uma recorrência
   * curta que geraria centenas de registros num intervalo pequeno.
   */
  calculateOccurrences(
    start: Date,
    recurrence: RecurrenceType,
    end: Date,
  ): Date[] {
    if (recurrence === RecurrenceType.NONE) {
      return [start];
    }

    const horizon = new Date(start);
    horizon.setMonth(horizon.getMonth() + MAX_RECURRENCE_MONTHS);

    const lastDate = end < horizon ? end : horizon;
    const dates: Date[] = [];
    const cursor = new Date(start);

    while (cursor <= lastDate && dates.length < MAX_OCCURRENCES) {
      dates.push(new Date(cursor));
      this.advance(cursor, recurrence, dates.length);
    }

    return dates;
  }

  /**
   * Avança o cursor para a próxima ocorrência.
   *
   * `TWICE_WEEKLY` alterna 3 e 4 dias, o que reproduz o par
   * segunda/quinta da semana inteira sem precisar guardar os dias escolhidos.
   */
  private advance(
    cursor: Date,
    recurrence: RecurrenceType,
    index: number,
  ): void {
    switch (recurrence) {
      case RecurrenceType.WEEKLY:
        cursor.setDate(cursor.getDate() + 7);
        return;
      case RecurrenceType.BIWEEKLY:
        cursor.setDate(cursor.getDate() + 14);
        return;
      case RecurrenceType.TWICE_WEEKLY:
        cursor.setDate(cursor.getDate() + (index % 2 === 1 ? 3 : 4));
        return;
      case RecurrenceType.MONTHLY:
        cursor.setMonth(cursor.getMonth() + 1);
        return;
      case RecurrenceType.NONE:
        // Encerra o laço: sem recorrência não há próxima ocorrência.
        cursor.setFullYear(cursor.getFullYear() + 100);
        return;
    }
  }

  /**
   * Sugere horários livres no mesmo dia.
   *
   * Serve à resposta de conflito: em vez de só recusar, a API mostra quando o
   * professor está disponível. Os candidatos são gerados em memória e uma única
   * consulta busca as aulas do dia — o legado fazia uma consulta por horário
   * testado.
   */
  async suggestAlternatives(params: {
    teacherId: string;
    studentId: string;
    scheduledAt: Date;
    duration: number;
    excludeLessonId?: string;
    workingHours?: { startHour: number; endHour: number };
  }): Promise<Date[]> {
    const { startHour, endHour } = params.workingHours ?? {
      startHour: 8,
      endHour: 21,
    };

    const dayStart = new Date(params.scheduledAt);
    dayStart.setHours(startHour, 0, 0, 0);

    const dayEnd = new Date(params.scheduledAt);
    dayEnd.setHours(endHour, 0, 0, 0);

    const busy = await this.prisma.lesson.findMany({
      where: {
        status: LessonStatus.SCHEDULED,
        scheduledAt: {
          gte: new Date(dayStart.getTime() - MAX_LESSON_MINUTES * 60_000),
          lt: dayEnd,
        },
        ...(params.excludeLessonId
          ? { id: { not: params.excludeLessonId } }
          : {}),
        OR: [{ teacherId: params.teacherId }, { studentId: params.studentId }],
      },
      select: { scheduledAt: true, duration: true },
    });

    const suggestions: Date[] = [];
    const cursor = new Date(dayStart);

    while (cursor < dayEnd && suggestions.length < 5) {
      const slotEnd = new Date(cursor.getTime() + params.duration * 60_000);

      if (slotEnd <= dayEnd) {
        const overlaps = busy.some((lesson) => {
          const lessonEnd = new Date(
            lesson.scheduledAt.getTime() + lesson.duration * 60_000,
          );
          return cursor < lessonEnd && slotEnd > lesson.scheduledAt;
        });

        if (!overlaps && cursor.getTime() !== params.scheduledAt.getTime()) {
          suggestions.push(new Date(cursor));
        }
      }

      cursor.setMinutes(cursor.getMinutes() + 30);
    }

    return suggestions;
  }
}
