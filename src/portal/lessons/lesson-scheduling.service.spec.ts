import { RecurrenceType } from '@prisma/client';
import { LessonSchedulingService } from './lesson-scheduling.service';

const at = (iso: string) => new Date(iso);

// A conferência de conflitos mudou para o motor de regras (schedule-rules):
// aqui fica só a geração das datas da série.
describe('LessonSchedulingService', () => {
  const service = new LessonSchedulingService();

  describe('calculateOccurrences', () => {
    const start = at('2026-09-15T19:00:00.000Z');

    it('devolve uma única data quando não há recorrência', () => {
      const dates = service.calculateOccurrences(
        start,
        RecurrenceType.NONE,
        at('2026-12-15T19:00:00.000Z'),
      );

      expect(dates).toEqual([start]);
    });

    it('gera datas semanais', () => {
      const dates = service.calculateOccurrences(
        start,
        RecurrenceType.WEEKLY,
        at('2026-10-13T19:00:00.000Z'),
      );

      expect(dates).toHaveLength(5);
      expect(dates[1].getTime() - dates[0].getTime()).toBe(
        7 * 24 * 60 * 60 * 1000,
      );
    });

    it('gera datas quinzenais', () => {
      const dates = service.calculateOccurrences(
        start,
        RecurrenceType.BIWEEKLY,
        at('2026-10-13T19:00:00.000Z'),
      );

      expect(dates).toHaveLength(3);
    });

    it('gera datas mensais', () => {
      const dates = service.calculateOccurrences(
        start,
        RecurrenceType.MONTHLY,
        at('2026-12-15T19:00:00.000Z'),
      );

      expect(dates).toHaveLength(4);
    });

    // Alternar 3 e 4 dias reproduz o par segunda/quinta ao longo das semanas.
    it('alterna 3 e 4 dias em duas vezes por semana', () => {
      const dates = service.calculateOccurrences(
        start,
        RecurrenceType.TWICE_WEEKLY,
        at('2026-09-29T19:00:00.000Z'),
      );

      const firstGap = dates[1].getTime() - dates[0].getTime();
      const secondGap = dates[2].getTime() - dates[1].getTime();

      expect(firstGap).toBe(3 * 24 * 60 * 60 * 1000);
      expect(secondGap).toBe(4 * 24 * 60 * 60 * 1000);
    });

    // Evita uma série que nunca termina.
    it('limita o horizonte a 6 meses', () => {
      const dates = service.calculateOccurrences(
        start,
        RecurrenceType.MONTHLY,
        at('2030-01-01T19:00:00.000Z'),
      );

      expect(dates.length).toBeLessThanOrEqual(7);
    });

    // Protege de uma recorrência curta que geraria centenas de registros.
    it('limita o número de ocorrências', () => {
      const dates = service.calculateOccurrences(
        start,
        RecurrenceType.TWICE_WEEKLY,
        at('2027-03-15T19:00:00.000Z'),
      );

      expect(dates.length).toBeLessThanOrEqual(60);
    });
  });
});
