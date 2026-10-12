import type { EmailLanguage } from '../email-layout';

/** Writes a line in both languages; the recipient's one is kept. */
export type Say = (pt: string, en: string) => string;

/** What every template gets besides its own data. */
export interface TemplateContext {
  say: Say;
  language: EmailLanguage;
  /** Base URL of the site, for links (and the email images). */
  site: string;
}

export const LOCALES: Record<EmailLanguage, string> = {
  pt: 'pt-BR',
  en: 'en-US',
};
