import {
  findTask,
  isMaintenanceTaskId,
  MAINTENANCE_CATALOG,
  MAINTENANCE_TASK_IDS,
} from './maintenance-catalog';

describe('catálogo de manutenção', () => {
  it('todo id declarado tem uma tarefa', () => {
    for (const id of MAINTENANCE_TASK_IDS) {
      expect(findTask(id).id).toBe(id);
    }
  });

  it('não tem id repetido', () => {
    const ids = MAINTENANCE_CATALOG.map((task) => task.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  // O legado aceitava qualquer string e escrevia por cima do objeto de tarefa
  // com `Object.assign(task, body)`, inclusive sobre o campo que decide qual
  // código roda.
  it('recusa id fora do catálogo', () => {
    expect(isMaintenanceTaskId('database-cleanup')).toBe(false);
    expect(isMaintenanceTaskId('tokens.prune')).toBe(true);
  });

  it('toda tarefa com retenção declara o padrão em dias', () => {
    for (const task of MAINTENANCE_CATALOG) {
      if (task.id.endsWith('.prune')) {
        expect(task.retentionDays).toBeGreaterThan(0);
      }
    }
  });

  // **RN-5 decidida.** A retenção passou a ser por classe de ação, e com prazo
  // definido a tarefa ganhou agendamento: sem ele, a política existiria só no
  // documento. Continua destrutiva — expurgo apaga prova de ação
  // administrativa, e o painel exige confirmação por isso.
  it('o expurgo da auditoria é agendado e destrutivo', () => {
    expect(findTask('audit.prune').suggestedCron).not.toBeNull();
    expect(findTask('audit.prune').destructive).toBe(true);
  });

  // Órfão é sintoma de exclusão em cascata incompleta; apagar esconde a causa.
  it('a varredura de órfãos não é destrutiva', () => {
    expect(findTask('storage.orphan-sweep').destructive).toBe(false);
  });

  it('todo cron sugerido tem cinco campos', () => {
    for (const task of MAINTENANCE_CATALOG) {
      if (task.suggestedCron) {
        expect(task.suggestedCron.trim().split(/\s+/)).toHaveLength(5);
      }
    }
  });
});
