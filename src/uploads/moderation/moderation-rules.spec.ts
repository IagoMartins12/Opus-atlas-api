import {
  isGrave,
  isReportCategory,
  priorityOf,
  REPORT_CATEGORY_IDS,
} from './report-categories';
import {
  dueAt,
  hoursToDeadline,
  isOverdue,
  SLA_HOURS,
  slaMillis,
} from './moderation-sla';

describe('categorias de denúncia (RN-4)', () => {
  it('toda categoria tem prioridade conhecida', () => {
    for (const id of REPORT_CATEGORY_IDS) {
      expect(SLA_HOURS[priorityOf(id)]).toBeGreaterThan(0);
    }
  });

  // A categoria decide a urgência; quem denuncia não a escolhe, senão fura fila.
  it('direito autoral e conteúdo ilegal são urgentes', () => {
    expect(priorityOf('copyright')).toBe('urgent');
    expect(priorityOf('illegal')).toBe('urgent');
  });

  it('item duplicado é a menor prioridade', () => {
    expect(priorityOf('duplicate')).toBe('low');
  });

  // A lista de graves é curta de propósito: cada uma é um botão que qualquer
  // usuário autenticado aperta sozinho.
  it('só direito autoral e conteúdo ilegal são graves', () => {
    const graves = REPORT_CATEGORY_IDS.filter(isGrave);

    expect(graves.sort()).toEqual(['copyright', 'illegal']);
  });

  it('ofensivo e spam não disparam providência automática', () => {
    expect(isGrave('offensive')).toBe(false);
    expect(isGrave('spam')).toBe(false);
  });

  it('recusa categoria fora da lista', () => {
    expect(isReportCategory('qualquer-coisa')).toBe(false);
    expect(isReportCategory('copyright')).toBe(true);
  });
});

describe('prazo de análise (RN-4)', () => {
  const criada = new Date('2026-09-10T12:00:00Z');

  it('urgente vence em 24 horas', () => {
    expect(dueAt(criada, 'urgent')).toEqual(new Date('2026-09-11T12:00:00Z'));
  });

  it('baixa vence em 30 dias', () => {
    expect(slaMillis('low')).toBe(720 * 60 * 60 * 1000);
  });

  it('reconhece a denúncia atrasada', () => {
    expect(isOverdue(criada, 'urgent', new Date('2026-09-11T13:00:00Z'))).toBe(
      true,
    );
  });

  it('denúncia dentro do prazo não está atrasada', () => {
    expect(isOverdue(criada, 'urgent', new Date('2026-09-11T11:00:00Z'))).toBe(
      false,
    );
  });

  // É por este número que a fila é ordenada: uma urgente de ontem tem de vir
  // antes de uma comum de hoje.
  it('conta as horas que faltam, e negativa quando passou', () => {
    expect(
      hoursToDeadline(criada, 'urgent', new Date('2026-09-11T06:00:00Z')),
    ).toBe(6);
    expect(
      hoursToDeadline(criada, 'urgent', new Date('2026-09-11T18:00:00Z')),
    ).toBe(-6);
  });

  it('quanto mais grave, menor o prazo', () => {
    expect(SLA_HOURS.urgent).toBeLessThan(SLA_HOURS.high);
    expect(SLA_HOURS.high).toBeLessThan(SLA_HOURS.normal);
    expect(SLA_HOURS.normal).toBeLessThan(SLA_HOURS.low);
  });
});
