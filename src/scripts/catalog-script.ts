import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CATALOG_NAMESPACES } from '../common/cache/cache-keys';
import { AppCacheService } from '../common/cache/cache.service';
import { errorMessage } from '../common/utils/error.util';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A casca dos scripts de qualidade do acervo: abre a aplicação, entrega o
 * banco e `apply`, e fecha. **Simula por padrão**; só `--apply` grava, e só
 * então o cache do catálogo é limpo.
 */
export async function runCatalogScript(
  name: string,
  work: (ctx: {
    prisma: PrismaService;
    apply: boolean;
    logger: Logger;
  }) => Promise<void>,
): Promise<void> {
  const apply = process.argv.includes('--apply');
  const logger = new Logger(name);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    logger.log(apply ? 'GRAVANDO (--apply)' : 'Simulação: nada é gravado');
    await work({ prisma: app.get(PrismaService), apply, logger });
    if (apply)
      await app.get(AppCacheService).invalidateMany(CATALOG_NAMESPACES);
  } catch (error: unknown) {
    logger.error(`Falha: ${errorMessage(error)}`);
    process.exitCode = 1;
  } finally {
    await app.close();
    // Filas e conexões abertas pela aplicação seguram o processo vivo depois
    // do fim do trabalho; o script acaba aqui.
    process.exit(process.exitCode ?? 0);
  }
}

/** Fatias de um vetor, para `updateMany` com `id in` sem estourar o limite. */
export function chunks<T>(items: T[], size = 1000): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}
