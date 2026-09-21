/**
 * Utilitários para lidar com valores capturados em `catch`.
 *
 * Com `useUnknownInCatchVariables` ligado (tsconfig estrito), a variável de um
 * `catch` é `unknown` — que é o tipo correto, já que JavaScript permite lançar
 * qualquer valor, não só `Error`. Estas funções estreitam esse `unknown` de
 * forma segura, sem `any` e sem cast.
 */

/** Mensagem legível de qualquer valor lançado. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }

  return String(error);
}

/** Stack trace quando o valor lançado for um `Error` de verdade. */
export function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

/** Normaliza qualquer valor lançado para um `Error`, preservando o original. */
export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(errorMessage(error));
}
