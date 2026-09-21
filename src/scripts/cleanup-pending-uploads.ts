import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { StorageCleanupService } from '../common/storage/storage-cleanup.service';
import { errorMessage } from '../common/utils/error.util';

/**
 * Recolhe uploads assinados que nunca foram confirmados.
 *
 * Feito para rodar como job agendado (diário). Enquanto a fila não existe,
 * pode ser chamado pelo cron do sistema.
 *
 * Uso:
 *   node dist/scripts/cleanup-pending-uploads.js           # simulação
 *   node dist/scripts/cleanup-pending-uploads.js --apply
 */
const logger = new Logger('CleanupPendingUploads');

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const cleanup = app.get(StorageCleanupService);
    const report = await cleanup.cleanupStalePending(!apply);

    logger.log(
      `${apply ? 'Aplicado' : 'Simulação'} — examinados: ${report.pendingExamined}, ` +
        `removidos do provedor: ${report.uploadedButAbandoned}, ` +
        `nunca enviados: ${report.neverUploaded}, ` +
        `falhas: ${report.failures}`,
    );

    process.exitCode = report.failures > 0 ? 1 : 0;
  } finally {
    await app.close();
  }

  process.exit(process.exitCode ?? 0);
}

void main().catch((error: unknown) => {
  logger.error(`Erro fatal: ${errorMessage(error)}`);
  process.exit(1);
});
