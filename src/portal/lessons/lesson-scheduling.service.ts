import { Injectable } from '@nestjs/common';
import { RecurrenceType } from '@prisma/client';

/** Teto da série recorrente, para não gerar aulas indefinidamente. */
const MAX_RECURRENCE_MONTHS = 6;
const MAX_OCCURRENCES = 60;

/**
 * As datas de uma série recorrente. A conferência de conflitos mudou para o
 * `ScheduleRulesService` (04/10/2026), que olha a série inteira de uma vez.
 */
@Injectable()
export class LessonSchedulingService {
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
}
