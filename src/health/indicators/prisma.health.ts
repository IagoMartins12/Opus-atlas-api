import { Injectable } from '@nestjs/common';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { PrismaService } from '../../prisma/prisma.service';
import { errorMessage } from '../../common/utils/error.util';

/**
 * Verifica se o MongoDB responde, com um comando barato (`ping`) em vez de uma
 * query de coleção — o objetivo é medir a conexão, não a carga do banco.
 */
@Injectable()
export class PrismaHealthIndicator extends HealthIndicator {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const start = Date.now();

    try {
      await this.prisma.$runCommandRaw({ ping: 1 });

      return this.getStatus(key, true, { responseTimeMs: Date.now() - start });
    } catch (error: unknown) {
      throw new HealthCheckError(
        'Banco de dados indisponível',
        this.getStatus(key, false, { message: errorMessage(error) }),
      );
    }
  }
}
