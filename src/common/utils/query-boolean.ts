import { TransformFnParams } from 'class-transformer';

/**
 * Booleano vindo da query string, para `@Transform(queryBoolean)`.
 *
 * Com `enableImplicitConversion` ligado no `ValidationPipe` (main.ts), o
 * `value` que chega ao `@Transform` já passou por `Boolean("false")` — que é
 * `true`. Comparar `value` fazia `?filtro=false` filtrar como verdadeiro. Aqui
 * se lê o valor cru (`obj[key]`). O que não for "true"/"false" volta como
 * veio, para o `@IsBoolean` recusar.
 */
export function queryBoolean({ obj, key, value }: TransformFnParams): unknown {
  const raw: unknown =
    (obj as Record<string, unknown> | undefined)?.[key] ?? value;

  if (raw === true || raw === 'true') return true;
  if (raw === false || raw === 'false') return false;
  return raw;
}
