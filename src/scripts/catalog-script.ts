import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CacheNamespace, CATALOG_NAMESPACES } from '../common/cache/cache-keys';
import { AppCacheService } from '../common/cache/cache.service';
import { errorMessage } from '../common/utils/error.util';
import { PrismaService } from '../prisma/prisma.service';
import type { CatalogJobWork, JobArgs } from '../catalog/jobs/job-types';

/**
 * A casca dos scripts de qualidade do acervo na linha de comando: abre a
 * aplicação, entrega o banco e `apply`, e fecha. **Simula por padrão**; só
 * `--apply` grava, e só então o cache do catálogo é limpo. A lógica de cada
 * rotina está em `src/catalog/jobs`, a mesma que o painel executa.
 */
export async function runCatalogScript(
  name: string,
  work: CatalogJobWork,
): Promise<void> {
  const apply = process.argv.includes('--apply');
  const args: JobArgs = {};
  for (const arg of process.argv.slice(2)) {
    const m = /^--([\w-]+)=(.*)$/.exec(arg);
    if (m) args[m[1]] = m[2];
  }
  const logger = new Logger(name);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    logger.log(apply ? 'GRAVANDO (--apply)' : 'Simulação: nada é gravado');
    await work({
      prisma: app.get(PrismaService),
      apply,
      logger,
      args,
      progress: () => undefined,
      shouldStop: () => false,
    });
    if (apply)
      await app
        .get(AppCacheService)
        .invalidateMany([...CATALOG_NAMESPACES, CacheNamespace.COLLECTIONS]);
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

export { chunks } from '../catalog/jobs/job-types';
