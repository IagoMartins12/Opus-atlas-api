import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { map, type Observable } from 'rxjs';
import { localeFromHeader, SOURCE_LOCALE, type Locale } from './locale';
import { translate } from './translate';
import { TRANSLATE_FIELDS } from './translate-fields.decorator';

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Answers in the language the request asks for (`Accept-Language`): the
 * top-level `message` of every response and the fields a route names with
 * `@TranslateFields`. Errors are translated by the `AllExceptionsFilter`.
 */
@Injectable()
export class I18nInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const locale = localeFromHeader(
      http.getRequest<Request>().headers['accept-language'],
    );
    const fields =
      this.reflector.getAllAndOverride<string[]>(TRANSLATE_FIELDS, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    // The same address answers differently per language: shared caches must
    // keep one copy per language.
    http.getResponse<Response>().vary('Accept-Language');
    if (locale === SOURCE_LOCALE) return next.handle();
    return next
      .handle()
      .pipe(map((body) => this.localize(body, locale, fields)));
  }

  private localize(body: unknown, locale: Locale, fields: string[]): unknown {
    if (!isObject(body)) return body;
    const out: Json = { ...body };
    if (typeof out.message === 'string')
      out.message = translate(out.message, locale);
    if (!fields.length) return out;
    const fix = (item: unknown) => {
      if (!isObject(item)) return item;
      const copy: Json = { ...item };
      for (const f of fields)
        if (typeof copy[f] === 'string')
          copy[f] = translate(copy[f] as string, locale);
      return copy;
    };
    for (const [key, value] of Object.entries(out))
      if (Array.isArray(value)) out[key] = value.map(fix);
    return fix(out);
  }
}
