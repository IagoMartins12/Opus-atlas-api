import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QUEUE_NAMES, QUEUE_PREFIX } from './queue.constants';
import { parseRedisUrl } from './redis-connection';
import { QueueService } from './queue.service';
import { JobStatusService } from './job-status.service';
import { JobEventsService } from './job-events.service';
import { JobsGateway } from './jobs.gateway';

/**
 * Infraestrutura de fila (Etapa 1.6).
 *
 * **Antecipada em relação ao roadmap, e de propósito.** A fatia 9 do Admin
 * (backup, arquivos órfãos, scrapers, manutenção) é inteira de trabalho longo:
 * sem fila, cada uma dessas rotas viraria ou um `202` apontando para nada, ou
 * uma requisição HTTP de vários minutos — que foi exatamente o problema que a
 * migração veio resolver. Construir a fila antes evita acumular quatro stubs.
 *
 * O módulo é global porque quem enfileira está espalhado por área (admin,
 * portal, perfil) e injetar `QueueService` não deve custar um import novo em
 * cada módulo.
 *
 * **Os produtores são registrados em todo processo; os consumidores não.** As
 * filas aqui são só o lado de escrita — baratas, e o processo `api` precisa
 * delas para enfileirar. Os processors vivem em `WorkerModule`, importado
 * condicionalmente por `AppModule` conforme `QUEUE_ROLE`.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: parseRedisUrl(
          configService.get<string>('redis.url', 'redis://localhost:6379'),
        ),
        // Prefixo próprio: as chaves da fila não se misturam com as do cache
        // nem com as do rate limit, que vivem no mesmo Redis. Sem isso, um
        // `FLUSHDB` para limpar cache levaria a fila junto.
        prefix: QUEUE_PREFIX,
      }),
    }),
    BullModule.registerQueue(...QUEUE_NAMES.map((name) => ({ name }))),
  ],
  providers: [QueueService, JobStatusService, JobEventsService, JobsGateway],
  exports: [QueueService, JobStatusService, JobEventsService, BullModule],
})
export class QueueModule {}
