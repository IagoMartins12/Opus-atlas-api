import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { errorMessage } from '../utils/error.util';
import { maskIp } from '../utils/ip-mask';

export interface AuditEntry {
  actorId?: string;
  actorRole?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  success: boolean;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grava uma entrada de auditoria.
   *
   * Nunca lança: falha ao auditar não pode derrubar a operação de negócio que
   * já aconteceu. O erro é registrado em nível `error` para que a própria falha
   * de auditoria seja visível no monitoramento.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.adminAuditLog.create({
        data: {
          actorId: entry.actorId,
          actorRole: entry.actorRole,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          metadata: entry.metadata,
          // Só a rede (/24 ou /48): o endereço completo identificaria a pessoa.
          ipAddress: maskIp(entry.ipAddress),
          userAgent: entry.userAgent,
          requestId: entry.requestId,
          success: entry.success,
        },
      });
    } catch (error: unknown) {
      // O erro de validação do Prisma começa com quebra de linha: sem o
      // `trim`, o log mostrava a mensagem vazia.
      this.logger.error(
        `Falha ao gravar auditoria da ação "${entry.action}": ${errorMessage(error).trim()}`,
      );
    }
  }
}
