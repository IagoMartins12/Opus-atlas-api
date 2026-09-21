import {
  GRAVE_ACTIONS,
  READ_ACTIONS,
  RETENTION_DAYS,
  retentionClassOf,
  retentionDaysOf,
} from './audit-retention';

describe('retenção da auditoria (RN-5)', () => {
  it('leitura sai antes de escrita, e escrita antes dos atos graves', () => {
    expect(RETENTION_DAYS.read).toBeLessThan(RETENTION_DAYS.write);
    expect(RETENTION_DAYS.write).toBeLessThan(RETENTION_DAYS.grave);
  });

  it('consulta ao banco é leitura', () => {
    expect(retentionClassOf('database.records.read')).toBe('read');
    expect(retentionDaysOf('database.records.read')).toBe(90);
  });

  // Exportar não muda nada no sistema, mas produz um arquivo com dado de gente
  // fora dele: se perguntarem quem tirou a base de assinantes, a resposta não
  // pode ter sido apagada em noventa dias.
  it('exportação é ato grave, não leitura', () => {
    expect(retentionClassOf('newsletter.subscribers.export')).toBe('grave');
    expect(retentionClassOf('user.export')).toBe('grave');
    expect(retentionClassOf('database.export')).toBe('grave');
  });

  it('mudança de usuário é ato grave — é por ela que o papel muda', () => {
    expect(retentionClassOf('user.update')).toBe('grave');
  });

  it('moderação e escrita ficam dois anos', () => {
    expect(retentionDaysOf('moderation.resolve')).toBe(730);
    expect(retentionDaysOf('work.update')).toBe(730);
  });

  // Errar para o lado de guardar é reversível; expurgar não é.
  it('ação desconhecida cai na classe mais longa entre as não-graves', () => {
    expect(retentionClassOf('acao.que.ainda.nao.existe')).toBe('write');
    expect(retentionDaysOf('acao.que.ainda.nao.existe')).toBeGreaterThan(
      RETENTION_DAYS.read,
    );
  });

  // Uma ação em duas listas teria retenção ambígua.
  it('nenhuma ação está em duas classes', () => {
    const repetidas = READ_ACTIONS.filter((action) =>
      (GRAVE_ACTIONS as readonly string[]).includes(action),
    );

    expect(repetidas).toEqual([]);
  });
});
