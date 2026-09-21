/**
 * Filas registradas no processo.
 *
 * A lista é **fechada de propósito**. Registrar uma fila sem processor cria um
 * lugar onde job entra e nunca sai: a rota responde 202 com um id, o
 * administrador acha que pediu o trabalho, e o trabalho nunca acontece — sem
 * erro em lugar nenhum. Cada nome só entra aqui junto com o processor que o
 * consome.
 *
 * Por isso a fila de scraping, backup e manutenção ainda não aparecem: elas
 * chegam nas fatias que trazem os processors correspondentes.
 */
/**
 * Prefixo das chaves da fila no Redis.
 *
 * **Precisa ser o mesmo em quem publica e em quem escuta.** O `BullModule`
 * monta as filas com ele e o `QueueEvents` do gateway se conecta ao mesmo
 * fluxo; se os dois divergirem, nada quebra — o gateway simplesmente nunca
 * recebe evento nenhum, e a barra de progresso fica parada em zero sem erro em
 * lugar nenhum. Por isso o valor mora aqui, e não literal em cada lado.
 */
export const QUEUE_PREFIX = 'opus-queue';

export const QUEUE_NEWSLETTER = 'newsletter';

/** Manutenção: limpeza, expurgo por retenção e reconstrução de índice. */
export const QUEUE_MAINTENANCE = 'maintenance';

/**
 * Scraping de programação das casas de espetáculo.
 *
 * É a fila que justifica a separação `api`/`worker`: os scrapers abrem
 * navegador e fazem dezenas de requisições externas, e é isso que o alvo
 * `worker` do Dockerfile carrega o Chromium para fazer.
 */
export const QUEUE_SCRAPER = 'scraper';

/**
 * Notificações automáticas do portal.
 *
 * Fila própria e não uma tarefa de manutenção: manutenção é limpeza, isto é
 * comportamento de produto. E a cadência é outra — a varredura roda de cinco em
 * cinco minutos, enquanto a limpeza roda de madrugada.
 */
export const QUEUE_NOTIFICATIONS = 'notifications';

export const QUEUE_NAMES = [
  QUEUE_NEWSLETTER,
  QUEUE_MAINTENANCE,
  QUEUE_SCRAPER,
  QUEUE_NOTIFICATIONS,
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

export function isQueueName(value: string): value is QueueName {
  return (QUEUE_NAMES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Nomes de job
// ---------------------------------------------------------------------------

/**
 * Resolve o público da campanha e enfileira os lotes de envio.
 *
 * O disparo é dividido em dois jobs porque **planejar e enviar falham por
 * motivos diferentes**: planejar é uma consulta ao banco, enviar é rede com
 * terceiro. Se o SMTP recusar o lote 7 de 40, só o lote 7 tenta de novo — não
 * a campanha inteira.
 */
export const JOB_NEWSLETTER_PLAN = 'newsletter.campaign.plan';

/** Envia um lote de destinatários de uma campanha. */
export const JOB_NEWSLETTER_BATCH = 'newsletter.campaign.batch';

/**
 * Executa uma tarefa do catálogo de manutenção.
 *
 * Um nome de job só para toda a manutenção, com a tarefa no payload: o que
 * varia entre elas é o que fazem, não como são despachadas.
 */
export const JOB_MAINTENANCE_RUN = 'maintenance.task.run';

/** Raspa a programação de uma casa e importa o que for novo. */
export const JOB_SCRAPER_RUN = 'scraper.venue.run';

/** Varre a base e emite as notificações automáticas devidas. */
export const JOB_NOTIFICATIONS_SWEEP = 'notifications.sweep';

/**
 * Varredura de denúncias fora do prazo (RN-4).
 *
 * Mora na fila de notificações, e não numa fila própria, porque é da mesma
 * natureza: uma varredura periódica que termina avisando alguém. Abrir uma
 * fila para um job só seria abrir um lugar a mais para um consumidor faltar.
 */
export const JOB_MODERATION_SLA_SWEEP = 'moderation.sla-sweep';

/**
 * Publica os artigos do blog cuja data agendada chegou.
 *
 * Na fila de notificações pelo mesmo motivo da varredura de moderação: é uma
 * varredura periódica de comportamento de produto, e uma fila para um job só
 * seria um lugar a mais para um consumidor faltar.
 */
export const JOB_BLOG_PUBLISH_SCHEDULED = 'blog.publish-scheduled';
