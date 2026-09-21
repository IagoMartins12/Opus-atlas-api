import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../common/decorators/api-key.decorator';
import { PrismaHealthIndicator } from './indicators/prisma.health';
import { RedisHealthIndicator } from './indicators/redis.health';

/**
 * Liveness e readiness separados (seção 3.9.4 da SPEC).
 *
 * A distinção não é cosmética: o orquestrador reinicia o container quando a
 * *liveness* falha, e apenas tira a instância do balanceador quando a
 * *readiness* falha. Um `/health` que checa o banco faria o Kubernetes matar
 * todas as réplicas durante uma instabilidade do Mongo, transformando uma
 * degradação em queda total.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({
    summary: 'Liveness — o processo está vivo',
    description:
      'Não toca dependência externa de propósito. Responde 200 enquanto o processo ' +
      'consegue atender requisições, mesmo que banco ou cache estejam degradados. ' +
      'É esta rota que o orquestrador usa para decidir reiniciar o container.',
  })
  @ApiOkResponse({ description: 'Processo vivo' })
  liveness(): HealthCheckResult | Promise<HealthCheckResult> {
    return this.health.check([
      // Heap acima de 512MB indica vazamento — aí reiniciar é a ação correta.
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),
    ]);
  }

  @Public()
  @Get('ready')
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness — a instância consegue atender de verdade',
    description:
      'Checa banco (Prisma/MongoDB) e cache (Redis). Falha aqui tira a instância do ' +
      'balanceador sem reiniciá-la, que é o comportamento correto quando a dependência ' +
      'externa é que está fora.',
  })
  @ApiOkResponse({ description: 'Instância pronta para receber tráfego' })
  readiness(): HealthCheckResult | Promise<HealthCheckResult> {
    return this.health.check([
      () => this.prisma.isHealthy('database'),
      () => this.redis.isHealthy('cache'),
    ]);
  }
}
