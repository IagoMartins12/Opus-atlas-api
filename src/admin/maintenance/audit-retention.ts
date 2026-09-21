/**
 * Retenção da trilha de auditoria por classe de ação (RN-5).
 *
 * **Um prazo único obrigaria a escolher entre perder prova e guardar lixo.**
 * "Quem abriu a lista de usuários" e "quem apagou uma conta" não têm o mesmo
 * peso: o primeiro é ruído operacional que se acumula todo dia, o segundo é o
 * registro que sustenta a decisão se ela for questionada meses depois. Guardar
 * os dois pelo mesmo tempo é curto demais para um e longo demais para o outro.
 *
 * Três classes, e a mais longa vale para tudo que não for classificado — errar
 * para o lado de guardar é reversível; expurgar não é.
 */
export const RETENTION_DAYS = {
  /** Consulta que não muda nada e não extrai dossiê. */
  read: 90,
  /** Escrita, moderação, operação. É o padrão. */
  write: 730,
  /** Exclusão de conta, papel, cobrança e extração de dado pessoal. */
  grave: 1825,
} as const;

export type RetentionClass = keyof typeof RETENTION_DAYS;

/**
 * Ações de leitura.
 *
 * Lista fechada de propósito: uma ação nova só entra aqui se alguém decidir
 * que ela é leitura. Sem isso, bastaria um nome terminado em `.read` para uma
 * escrita ser expurgada em noventa dias.
 */
export const READ_ACTIONS = [
  'database.models.list',
  'database.records.read',
  'database.schema.read',
  'imslp.composer.discover',
  'imslp.composer.scrape',
  'imslp.work.scrape',
  'wikipedia.composer.scrape',
] as const;

/**
 * Ações que exigem prova por muito tempo.
 *
 * **As exportações estão aqui, e não em leitura.** Exportar não muda nada no
 * sistema, mas produz um arquivo com dado de gente fora dele — se alguém
 * perguntar quem tirou a base de assinantes, a resposta não pode ter sido
 * apagada em noventa dias. `user.update` entra porque é por ela que o papel de
 * um usuário muda.
 */
export const GRAVE_ACTIONS = [
  'audit.export',
  'database.export',
  'newsletter.analytics.export',
  'newsletter.subscribers.export',
  'user.export',
  'user.update',
  'user.delete',
  'account.delete',
  'coupon.create',
  'coupon.delete',
  'coupon.toggle',
  'coupon.update',
  'plan-pricing.update',
  'subscription.cancel',
  'subscription.update',
] as const;

/** A classe de uma ação. O que não está classificado é `write`. */
export function retentionClassOf(action: string): RetentionClass {
  if ((READ_ACTIONS as readonly string[]).includes(action)) {
    return 'read';
  }

  if ((GRAVE_ACTIONS as readonly string[]).includes(action)) {
    return 'grave';
  }

  return 'write';
}

/** Quantos dias esta ação é guardada. */
export function retentionDaysOf(action: string): number {
  return RETENTION_DAYS[retentionClassOf(action)];
}
