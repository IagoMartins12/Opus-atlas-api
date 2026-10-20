import { SetMetadata } from '@nestjs/common';

export const TRANSLATE_FIELDS = 'i18n:translate-fields';

/**
 * Fields the `I18nInterceptor` translates beyond the top-level `message`, in
 * the objects of the response and of its arrays (one level deep): the
 * `title` and `message` of a notification list, for instance.
 */
export const TranslateFields = (...fields: string[]) =>
  SetMetadata(TRANSLATE_FIELDS, fields);
