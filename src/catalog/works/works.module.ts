import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ExternalPageFetcher } from '../../scrapers/imslp/external-page.fetcher';
import { ImslpScoresService } from './imslp-scores.service';
import { WorksController } from './works.controller';
import { WorksService } from './works.service';

@Module({
  imports: [PrismaModule],
  controllers: [WorksController],
  // O `ExternalPageFetcher` não tem dependência: registrado aqui em vez de
  // importar o módulo de scrapers inteiro (e a fila junto) no catálogo.
  providers: [WorksService, ImslpScoresService, ExternalPageFetcher],
  exports: [WorksService],
})
export class WorksModule {}
