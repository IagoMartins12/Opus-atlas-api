import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { BackupRunDto } from './dto/backup.dto';
import type { ResultadoDoBackup } from './backup.service';

/**
 * O histórico das execuções do backup.
 *
 * Existe para responder a pergunta que importa quando alguém precisa de um
 * backup: *o último funcionou?* Sem registro, a resposta seria "o job não
 * acusou erro", que não é a mesma coisa.
 */
@Injectable()
export class BackupHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async iniciar(): Promise<string> {
    const registro = await this.prisma.backupRun.create({
      data: { status: 'running' },
    });

    return registro.id;
  }

  async concluir(id: string, resultado: ResultadoDoBackup): Promise<void> {
    await this.prisma.backupRun.update({
      where: { id },
      data: {
        status: 'ok',
        finishedAt: new Date(),
        objectKey: resultado.objectKey,
        sizeBytes: resultado.sizeBytes,
        documentCount: resultado.documentCount,
        collections: resultado.collections as unknown as Prisma.InputJsonValue,
        verifiedAt: resultado.verifiedAt,
        rotated: resultado.rotated as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async falhar(id: string, erro: string): Promise<void> {
    await this.prisma.backupRun.update({
      where: { id },
      data: { status: 'failed', finishedAt: new Date(), error: erro },
    });
  }

  async listar(limite: number): Promise<BackupRunDto[]> {
    const registros = await this.prisma.backupRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: limite,
    });

    return registros.map((registro) => ({
      id: registro.id,
      startedAt: registro.startedAt.toISOString(),
      finishedAt: registro.finishedAt?.toISOString() ?? null,
      status: registro.status,
      objectKey: registro.objectKey,
      sizeBytes: registro.sizeBytes,
      documentCount: registro.documentCount,
      verifiedAt: registro.verifiedAt?.toISOString() ?? null,
      error: registro.error,
      collections:
        (registro.collections as unknown as Array<{
          name: string;
          documents: number;
        }>) ?? undefined,
      rotated: (registro.rotated as unknown as string[]) ?? undefined,
    }));
  }
}
