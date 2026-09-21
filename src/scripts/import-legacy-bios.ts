import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { AppModule } from '../app.module';
import { CacheNamespace } from '../common/cache/cache-keys';
import { AppCacheService } from '../common/cache/cache.service';
import { errorMessage } from '../common/utils/error.util';
import { hasBio } from '../catalog/composers/composer-bio.prompt';
import {
  LegacyBioCache,
  parseLegacyBioCache,
} from '../catalog/composers/legacy-bio-cache';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Traz para o banco as biografias que o legado guardava em
 * `public/translations/composers-bio.json`.
 *
 * O arquivo era **escrito em tempo de execução, no disco do servidor** — o de
 * produção pode ter muito mais entradas que o do repositório. Rode com o
 * arquivo do servidor.
 *
 * Nunca sobrescreve: só preenche `bio`/`bioEn` que estejam vazias no banco.
 *
 * Uso:
 *   node dist/scripts/import-legacy-bios.js <arquivo.json>            # simulação
 *   node dist/scripts/import-legacy-bios.js <arquivo.json> --apply    # aplica
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const file = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  const logger = new Logger('ImportLegacyBios');

  if (!file) {
    logger.error('Informe o caminho do composers-bio.json');
    process.exitCode = 1;
    return;
  }

  const bios = parseLegacyBioCache(
    JSON.parse(readFileSync(file, 'utf-8')) as LegacyBioCache,
  );
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const cache = app.get(AppCacheService);
  let pt = 0;
  let en = 0;
  let missing = 0;

  try {
    for (const [id, legacy] of bios) {
      const composer = await prisma.composer.findUnique({
        where: { id },
        select: { bio: true, bioEn: true },
      });

      if (!composer) {
        missing++;
        continue;
      }

      const data: { bio?: string; bioEn?: string } = {};
      if (legacy.pt && !hasBio(composer.bio)) data.bio = legacy.pt;
      if (legacy.en && !hasBio(composer.bioEn)) data.bioEn = legacy.en;

      if (data.bio) pt++;
      if (data.bioEn) en++;

      if (apply && (data.bio || data.bioEn)) {
        await prisma.composer.update({ where: { id }, data });
        await cache.del(`${CacheNamespace.COMPOSERS}:detail:${id}`);
      }
    }

    logger.log(
      `${apply ? 'Gravadas' : '[simulação] gravaria'}: ${pt} em português, ${en} em inglês ` +
        `(${bios.size} compositores no arquivo, ${missing} fora do banco)`,
    );
  } catch (error: unknown) {
    logger.error(`Falha: ${errorMessage(error)}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    new Logger('ImportLegacyBios').error(`Erro fatal: ${errorMessage(error)}`);
    process.exit(1);
  });
