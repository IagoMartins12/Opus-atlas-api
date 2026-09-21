import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { ArticlesModule } from '../blog/articles/articles.module';
import { PortalModule } from '../portal/portal.module';
import { ScrapersModule } from '../scrapers/scrapers.module';
import { UploadsModule } from '../uploads/uploads.module';
import { QUEUE_NAMES } from '../common/queue/queue.constants';
import { resolveQueueRole } from '../common/queue/queue-role';
import { MaintenanceProcessor } from './maintenance.processor';
import { NewsletterProcessor } from './newsletter.processor';
import { NotificationsProcessor } from './notifications.processor';
import { ScraperProcessor } from './scraper.processor';

/**
 * Os consumidores de fila.
 *
 * **Só é importado quando `QUEUE_ROLE` inclui `worker`.** Registrar um
 * `@Processor` abre um worker BullMQ, e um worker aberto consome job — o que
 * significa que, sem essa condição, toda réplica da API estaria também
 * processando trabalho pesado no mesmo processo que atende requisição. Era
 * exatamente o problema que o alvo `worker` do Dockerfile foi criado para
 * resolver e, até aqui, não resolvia: os dois alvos rodavam o mesmo processo.
 *
 * Importa os módulos de domínio porque a lógica não mora aqui. Um processor é
 * um adaptador: traduz um job numa chamada de serviço, e nada mais.
 */
@Module({
  imports: [
    AdminModule,
    ScrapersModule,
    PortalModule,
    UploadsModule,
    ArticlesModule,
  ],
  providers: [
    NewsletterProcessor,
    MaintenanceProcessor,
    ScraperProcessor,
    NotificationsProcessor,
  ],
})
export class WorkerModule implements OnModuleInit {
  private readonly logger = new Logger(WorkerModule.name);

  onModuleInit(): void {
    this.logger.log(
      `Papel ${resolveQueueRole()} — consumindo as filas: ${QUEUE_NAMES.join(', ')}`,
    );
  }
}
