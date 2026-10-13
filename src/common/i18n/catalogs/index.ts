import type { TargetLocale } from '../locale';
import { en } from './en';

/** Portuguese source text → text in the language. */
export type Catalog = Readonly<Record<string, string>>;

export const CATALOGS: Record<TargetLocale, Catalog> = { en };
