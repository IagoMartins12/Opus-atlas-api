import { Prisma } from '@prisma/client';

/**
 * Converte um objeto livre de DTO no tipo aceito por um campo `Json` do Prisma.
 *
 * DTOs declaram esses campos como `Record<string, unknown>` (que é o tipo
 * honesto para JSON arbitrário validado por `@IsObject()`), mas o Prisma exige
 * `InputJsonValue`. Os dois são estruturalmente compatíveis — esta função faz
 * a ponte num único lugar, em vez de espalhar `as any` por cada service.
 */
export function toJsonInput(
  value: Record<string, unknown> | undefined | null,
): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return value as Prisma.InputJsonValue;
}
