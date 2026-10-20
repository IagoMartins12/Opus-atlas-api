/**
 * De `entityType` (o texto livre do `@Audited()`) ao model do Prisma.
 *
 * `label` são os campos que dão nome ao registro, em ordem de preferência:
 * é o que faz a trilha dizer "alterou a obra **Clair de lune**" em vez de
 * "alterou work 64f…". A trilha guarda o nome **no momento da ação** — se a
 * obra for renomeada ou apagada depois, o registro continua legível.
 *
 * Tipo que não está aqui (job, scraper, tarefa de manutenção, backup) é
 * auditado como sempre foi: sem foto, com o corpo da requisição limpo.
 */
export interface AuditEntity {
  model: string;
  label: readonly string[];
}

export const AUDIT_ENTITIES: Readonly<Record<string, AuditEntity>> = {
  user: { model: 'User', label: ['firstName', 'lastName', 'email'] },
  composer: { model: 'Composer', label: ['name', 'fullName'] },
  work: { model: 'Work', label: ['title'] },
  workScore: { model: 'WorkScore', label: ['title', 'type'] },
  uploadModeration: {
    model: 'UploadModeration',
    label: ['reason', 'entityType'],
  },
  generatedReport: { model: 'GeneratedReport', label: ['name', 'filename'] },
  advertisement: { model: 'Advertisement', label: ['title', 'advertiserName'] },
  subscriber: {
    model: 'NewsletterSubscriber',
    label: ['firstName', 'lastName', 'email'],
  },
  template: { model: 'NewsletterTemplate', label: ['name', 'subject'] },
  campaign: { model: 'NewsletterCampaign', label: ['name', 'subject'] },
  testList: { model: 'TestEmailList', label: ['name'] },
  'blog-article': { model: 'BlogArticle', label: ['title', 'slug'] },
  'blog-category': { model: 'BlogCategory', label: ['name', 'slug'] },
  'blog-tag': { model: 'BlogTag', label: ['name', 'slug'] },
  'blog-media': { model: 'BlogMedia', label: ['title', 'type'] },
  'blog-comment': { model: 'BlogComment', label: ['content'] },
  coupon: { model: 'Coupon', label: ['code'] },
  planPricing: { model: 'PlanPricing', label: ['planType'] },
  venue: { model: 'Venue', label: ['name', 'slug'] },
  event: { model: 'Event', label: ['title', 'slug'] },
};
