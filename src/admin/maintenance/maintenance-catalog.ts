/**
 * Catálogo de tarefas de manutenção.
 *
 * **O legado tinha um array mutável de módulo.** `MAINTENANCE_TASKS` vivia na
 * memória do processo, junto com um `Set` de tarefas rodando, e a rota de
 * atualização fazia `Object.assign(task, scheduleData)` — o corpo cru da
 * requisição escrito por cima do objeto compartilhado, inclusive sobre o campo
 * `script`, que é o que decide qual código roda. Três consequências:
 *
 * 1. Reiniciar o processo devolvia tudo ao estado inicial, sem aviso.
 * 2. Com duas réplicas, cada administrador via um estado diferente da mesma
 *    tarefa — inclusive "rodando" numa e "parada" na outra.
 * 3. Cinco das tarefas apontavam para `cleanCache`, `rotateLogFiles` e
 *    `optimizeDatabase`, que operavam arquivos de log e cache em disco local —
 *    coisas que a Etapa 0 removeu junto com o disco.
 *
 * Aqui o catálogo é **constante e conhecido em tempo de compilação**: nada de
 * fora escolhe o que executa, o estado de cada execução mora na fila, e o
 * `id` é um valor de união, não uma string qualquer.
 */

export const MAINTENANCE_TASK_IDS = [
  'storage.cleanup-pending',
  'storage.orphan-sweep',
  'tokens.prune',
  'notifications.prune',
  'audit.prune',
  'search.reindex',
  'database.backup',
] as const;

export type MaintenanceTaskId = (typeof MAINTENANCE_TASK_IDS)[number];

export type MaintenanceCategory = 'storage' | 'database' | 'search';

/** Quanto a tarefa pesa sobre o banco enquanto roda. */
export type MaintenanceImpact = 'low' | 'medium' | 'high';

export interface MaintenanceTask {
  id: MaintenanceTaskId;
  name: string;
  description: string;
  category: MaintenanceCategory;
  impact: MaintenanceImpact;
  /**
   * A tarefa apaga dado de forma irreversível?
   *
   * Não é rótulo decorativo: tarefa destrutiva **não pode ser agendada sem que
   * alguém escolha explicitamente**, e a rota de execução exige `confirm`.
   */
  destructive: boolean;
  /**
   * Expressão cron sugerida, no fuso de São Paulo.
   *
   * É só sugestão — o agendamento de verdade só existe se alguém criar.
   */
  suggestedCron: string | null;
  /** Parâmetro de retenção em dias, quando a tarefa tem um. */
  retentionDays?: number;
}

/** Fuso dos agendamentos. A plataforma é brasileira. */
export const SCHEDULE_TIMEZONE = 'America/Sao_Paulo';

export const MAINTENANCE_CATALOG: readonly MaintenanceTask[] = [
  {
    id: 'storage.cleanup-pending',
    name: 'Recolher uploads não confirmados',
    description:
      'Upload assinado que o cliente nunca confirmou. Quem enviou e não ' +
      'confirmou tem o arquivo removido do Cloudinary; quem nunca enviou tem ' +
      'só a reserva marcada como removida.',
    category: 'storage',
    impact: 'low',
    destructive: true,
    suggestedCron: '0 4 * * *',
  },
  {
    id: 'storage.orphan-sweep',
    name: 'Localizar arquivos órfãos',
    description:
      'Arquivos ativos cujo dono já não existe — a obra, o anúncio ou o ' +
      'artigo foi removido e o arquivo ficou. **Só relata; não apaga nada.**',
    category: 'storage',
    impact: 'medium',
    destructive: false,
    suggestedCron: '0 5 * * 0',
  },
  {
    id: 'database.backup',
    name: 'Backup do banco',
    description:
      'Exporta as coleções escolhidas em `/admin/backup`, envia ao bucket ' +
      'privado, **baixa de volta para conferir** e só então remove o arquivo ' +
      'mais antigo. Falha em qualquer passo não apaga nada.',
    category: 'database',
    impact: 'medium',
    destructive: false,
    suggestedCron: '0 3 * * *',
  },
  {
    id: 'tokens.prune',
    name: 'Expurgar tokens vencidos',
    description:
      'Tokens de uso único já usados ou expirados há mais de 30 dias. O ' +
      'token vencido não autentica nada; o que sobra é volume.',
    category: 'database',
    impact: 'low',
    destructive: true,
    suggestedCron: '30 4 * * *',
    retentionDays: 30,
  },
  {
    id: 'notifications.prune',
    name: 'Expurgar notificações vencidas',
    description:
      'Notificações com prazo já vencido, e notificações lidas há mais de ' +
      '90 dias. Notificação não lida nunca é removida por idade.',
    category: 'database',
    impact: 'low',
    destructive: true,
    suggestedCron: '45 4 * * *',
    retentionDays: 90,
  },
  {
    id: 'audit.prune',
    name: 'Aplicar retenção da trilha de auditoria',
    description:
      'Remove registros de `AdminAuditLog` conforme a retenção por classe de ' +
      'ação (**RN-5 decidida**): leitura em 90 dias, escrita e moderação em 2 ' +
      'anos, e atos graves — exclusão de conta, mudança de papel, cobrança e ' +
      'extração de dado pessoal — em 5 anos. O `retentionDays` da chamada é ' +
      '**piso**, não prazo: pedir menos não encurta a política.',
    category: 'database',
    impact: 'medium',
    destructive: true,
    // Semanal, de madrugada. A política é por classe e o expurgo é pequeno a
    // cada rodada; deixar sem agendamento era o que fazia a retenção não valer.
    suggestedCron: '30 3 * * 0',
    retentionDays: 90,
  },
  {
    id: 'search.reindex',
    name: 'Recriar índices de texto',
    description:
      'Recria os índices `$text` de obras, compositores e artigos. É a ' +
      'reparação de um caso concreto: `prisma db push` os derruba, porque o ' +
      'schema do Prisma não tem como declará-los, e até a próxima subida a ' +
      'busca varre as coleções inteiras.',
    category: 'search',
    impact: 'high',
    destructive: false,
    suggestedCron: null,
  },
];

const BY_ID = new Map<MaintenanceTaskId, MaintenanceTask>(
  MAINTENANCE_CATALOG.map((task) => [task.id, task]),
);

export function isMaintenanceTaskId(value: string): value is MaintenanceTaskId {
  return BY_ID.has(value as MaintenanceTaskId);
}

export function findTask(id: MaintenanceTaskId): MaintenanceTask {
  const task = BY_ID.get(id);

  if (!task) {
    throw new Error(`Tarefa de manutenção desconhecida: ${id}`);
  }

  return task;
}
