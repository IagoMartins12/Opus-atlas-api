import type { Logger } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * O contrato das rotinas do acervo (correções em lote do catálogo).
 *
 * Uma rotina é uma função que recebe o banco e `apply`: **simula por padrão**,
 * e só grava com `apply`. O mesmo código roda de dois jeitos — na linha de
 * comando (`src/scripts`, `runCatalogScript`) e no painel (`CatalogJobsService`,
 * pelo worker) — e por isso mora aqui, sem depender da aplicação inteira.
 */
export type JobLogger = Pick<Logger, 'log' | 'warn' | 'error'>;

/** Parâmetros opcionais de uma rotina (`--limit=N` na linha de comando). */
export type JobArgs = Record<string, string | number | undefined>;

export interface CatalogJobContext {
  prisma: PrismaService;
  apply: boolean;
  logger: JobLogger;
  args: JobArgs;
  /** Quanto já foi feito; o painel mostra a barra. `total` quando se sabe. */
  progress: (done: number, total?: number, message?: string) => void;
  /** Verdadeiro quando alguém pediu para parar; a rotina encerra no próximo passo. */
  shouldStop: () => boolean;
}

/** O que a rotina devolve para o histórico; o resto está no log. */
export interface CatalogJobOutcome {
  summary?: Record<string, number | string>;
  sample?: string[];
  warnings?: string[];
}

export type CatalogJobWork = (
  ctx: CatalogJobContext,
) => Promise<CatalogJobOutcome | void>;

/** Fatias de um vetor, para `updateMany` com `id in` sem estourar o limite. */
export function chunks<T>(items: T[], size = 1000): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
