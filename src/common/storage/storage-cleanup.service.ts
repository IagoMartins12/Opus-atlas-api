import { Injectable, Logger } from '@nestjs/common';
import { StorageAssetStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CloudinaryService } from './cloudinary.service';
import { errorMessage } from '../utils/error.util';

/** Uploads assinados e nunca confirmados expiram depois disso. */
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface CleanupReport {
  pendingExamined: number;
  uploadedButAbandoned: number;
  neverUploaded: number;
  failures: number;
}

/**
 * Recolhe uploads que ficaram pelo caminho.
 *
 * No fluxo assinado, o cliente pode desistir entre receber a assinatura e
 * confirmar o envio. Dois desfechos possíveis, tratados de forma diferente:
 *
 * - **Enviou e não confirmou**: o arquivo existe no Cloudinary e ninguém o
 *   referencia. É removido do provedor.
 * - **Nunca enviou**: só existe a reserva no banco. A linha é marcada como
 *   removida, sem chamada ao provedor.
 *
 * É a contrapartida do registro central: como toda reserva deixa rastro, a
 * limpeza é uma consulta ao próprio banco. Sem isso seria preciso varrer o
 * Cloudinary inteiro e adivinhar o que está órfão, que é o que o legado fazia.
 */
@Injectable()
export class StorageCleanupService {
  private readonly logger = new Logger(StorageCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async cleanupStalePending(dryRun = false): Promise<CleanupReport> {
    const cutoff = new Date(Date.now() - PENDING_MAX_AGE_MS);

    const stale = await this.prisma.storedAsset.findMany({
      where: {
        status: StorageAssetStatus.PENDING,
        createdAt: { lt: cutoff },
      },
      select: {
        id: true,
        publicId: true,
        resourceType: true,
      },
    });

    const report: CleanupReport = {
      pendingExamined: stale.length,
      uploadedButAbandoned: 0,
      neverUploaded: 0,
      failures: 0,
    };

    for (const asset of stale) {
      try {
        const remote = await this.cloudinary.getAsset(
          asset.publicId,
          asset.resourceType,
        );

        if (remote) {
          report.uploadedButAbandoned++;
          if (!dryRun) {
            await this.cloudinary.deleteAsset(
              asset.publicId,
              asset.resourceType,
            );
          }
        } else {
          report.neverUploaded++;
        }

        if (!dryRun) {
          await this.prisma.storedAsset.update({
            where: { id: asset.id },
            data: {
              status: StorageAssetStatus.DELETED,
              deletedAt: new Date(),
            },
          });
        }
      } catch (error: unknown) {
        report.failures++;
        this.logger.warn(
          `Falha ao limpar upload pendente ${asset.publicId}: ${errorMessage(error)}`,
        );
      }
    }

    if (report.pendingExamined > 0) {
      this.logger.log(
        `Limpeza de uploads pendentes${dryRun ? ' (simulação)' : ''}: ` +
          `${report.pendingExamined} examinados, ` +
          `${report.uploadedButAbandoned} removidos do provedor, ` +
          `${report.neverUploaded} nunca enviados, ` +
          `${report.failures} falhas`,
      );
    }

    return report;
  }
}
