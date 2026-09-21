import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  DEFAULT_MAX_POOL_SIZE,
  DEFAULT_MIN_POOL_SIZE,
  describePool,
  withPoolSize,
} from './pool';

/** O número de conexões por processo, dimensionável por ambiente. */
function poolSizeFromEnv(nome: string, padrao: number): number {
  const valor = Number(process.env[nome]);
  return Number.isFinite(valor) && valor > 0 ? valor : padrao;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  /**
   * A URL do banco com o pool dimensionado.
   *
   * Sem isto, cada processo abre até 100 conexões e o teto do cluster é
   * `100 × (réplicas de API + worker)` — o limite estoura justamente no pico,
   * que é quando escalar deveria ajudar. Ver `pool.ts` e SPEC §10.5/§11.6.
   * `DATABASE_MAX_POOL_SIZE` e `DATABASE_MIN_POOL_SIZE` ajustam por ambiente;
   * um parâmetro escrito na própria `DATABASE_URL` continua tendo prioridade.
   */
  constructor() {
    const url = withPoolSize(
      process.env.DATABASE_URL ?? '',
      poolSizeFromEnv('DATABASE_MAX_POOL_SIZE', DEFAULT_MAX_POOL_SIZE),
      poolSizeFromEnv('DATABASE_MIN_POOL_SIZE', DEFAULT_MIN_POOL_SIZE),
    );

    super({ datasourceUrl: url });

    this.poolDescription = describePool(url);
  }

  private readonly poolDescription: string;

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log(
      `Prisma conectado ao banco de dados (${this.poolDescription})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma desconectado do banco de dados');
  }
}
