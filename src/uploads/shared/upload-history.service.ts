import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { errorMessage } from '../../common/utils/error.util';

export type ContributionEntity = 'composer' | 'work' | 'score';
export type ContributionAction = 'create' | 'update' | 'delete';

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Histórico de contribuições da comunidade.
 *
 * Diferente de `AdminAuditLog`, que registra ação administrativa sobre o
 * sistema: aqui o registro é do próprio usuário sobre o conteúdo dele, e
 * alimenta as telas de "minhas contribuições" e as estatísticas de upload.
 *
 * Portado de `app/utils/historyUtils.ts`, que espalhava a montagem do registro
 * por cada route handler.
 */
@Injectable()
export class UploadHistoryService {
  private readonly logger = new Logger(UploadHistoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grava uma entrada de histórico.
   *
   * Nunca lança: a contribuição já foi persistida quando esta chamada acontece,
   * e perder o registro de histórico não pode desfazer nem falhar a operação
   * que o usuário acabou de completar com sucesso.
   */
  async record(params: {
    userId: string;
    entityType: ContributionEntity;
    entityId: string;
    action: ContributionAction;
    changes?: Prisma.InputJsonValue;
    reason?: string;
    context?: RequestContext;
  }): Promise<void> {
    try {
      await this.prisma.uploadHistory.create({
        data: {
          userId: params.userId,
          entityType: params.entityType,
          entityId: params.entityId,
          action: params.action,
          changes: params.changes,
          reason: params.reason,
          ipAddress: params.context?.ipAddress,
          userAgent: params.context?.userAgent,
        },
      });
    } catch (error: unknown) {
      this.logger.error(
        `Falha ao registrar histórico (${params.action} ${params.entityType} ${params.entityId}): ${errorMessage(error)}`,
      );
    }
  }

  /** Extrai IP e user agent de uma requisição, respeitando o proxy reverso. */
  static contextFrom(request: Request): RequestContext {
    const forwardedFor = request.headers['x-forwarded-for'];

    const ipAddress =
      typeof forwardedFor === 'string' && forwardedFor.length > 0
        ? forwardedFor.split(',')[0].trim()
        : request.ip;

    return { ipAddress, userAgent: request.headers['user-agent'] };
  }
}
