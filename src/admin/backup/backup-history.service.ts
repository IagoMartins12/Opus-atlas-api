import { Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(BackupHistoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async iniciar(): Promise<string> {
    await this.fecharInterrompidas();

    const registro = await this.prisma.backupRun.create({
      data: { status: 'running' },
    });

    return registro.id;
  }

  /**
   * Marca como falha as execuções que ficaram `running` sem ninguém para
   * terminá-las.
   *
   * **Um processo morto não escreve o próprio epitáfio.** Quando o contêiner
   * reinicia no meio de um backup — foi o que aconteceu em homologação, por
   * falta de memória —, o `catch` que marcaria a falha nunca roda: o registro
   * fica `running` para sempre, e a tela passa a mostrar um backup
   * eternamente em andamento. Pior que o erro é a tela que não conta.
   *
   * Duas horas porque um backup de base grande leva minutos, não horas; e
   * porque errar para mais só atrasa o aviso, enquanto errar para menos
   * marcaria como morta uma execução viva.
   */
  private async fecharInterrompidas(): Promise<void> {
    const limite = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const { count } = await this.prisma.backupRun.updateMany({
      where: { status: 'running', startedAt: { lt: limite } },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        error:
          'Execução interrompida: o processo terminou antes de concluir o ' +
          'backup (reinício do contêiner ou falta de memória).',
      },
    });

    if (count > 0) {
      this.logger.warn(
        `${count} execução(ões) de backup interrompida(s) marcada(s) como falha.`,
      );
    }
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
