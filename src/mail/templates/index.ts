/**
 * The text of every email, one file per group. Each template is a pure
 * function of its data and the context (`say`, language, site) that returns
 * the layout's spec; `MailService` only finds the language and sends.
 */
export * from './account';
export * from './billing';
export * from './contact';
export * from './newsletter';
export * from './portal';
export type { Say, TemplateContext } from './context';
