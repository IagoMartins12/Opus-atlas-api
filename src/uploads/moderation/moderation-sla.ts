import { ReportPriority } from './report-categories';

/**
 * Prazo de análise por prioridade, em horas.
 *
 * **Decisão de produto RN-4.** O campo `priority` existia no schema desde o
 * legado, com quatro valores, e nunca era escrito nem lido: toda denúncia
 * nascia `normal` e ficava na fila sem prazo nenhum. Os números abaixo são o
 * que faltava para "SLA" deixar de ser palavra em documento.
 */
export const SLA_HOURS: Record<ReportPriority, number> = {
  urgent: 24,
  high: 72,
  normal: 168,
  low: 720,
};

const HOUR_MS = 60 * 60 * 1000;

/** O prazo desta prioridade, em milissegundos. */
export function slaMillis(priority: ReportPriority): number {
  return SLA_HOURS[priority] * HOUR_MS;
}

/** Quando esta denúncia precisa estar resolvida. */
export function dueAt(createdAt: Date, priority: ReportPriority): Date {
  return new Date(createdAt.getTime() + SLA_HOURS[priority] * HOUR_MS);
}

/** A denúncia passou do prazo? */
export function isOverdue(
  createdAt: Date,
  priority: ReportPriority,
  now: Date,
): boolean {
  return dueAt(createdAt, priority) < now;
}

/**
 * Quanto falta (ou passou) do prazo, em horas.
 *
 * Negativo quer dizer atrasado. É o número que a fila mostra ao moderador, e é
 * por ele que ela é ordenada: uma denúncia urgente de ontem tem de vir antes de
 * uma denúncia comum de hoje, e ordenar por data de criação faz o contrário.
 */
export function hoursToDeadline(
  createdAt: Date,
  priority: ReportPriority,
  now: Date,
): number {
  return Math.round(
    (dueAt(createdAt, priority).getTime() - now.getTime()) / HOUR_MS,
  );
}
