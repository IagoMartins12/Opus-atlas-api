import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { UploadHistoryService } from './shared/upload-history.service';
import { ComposerUploadsController } from './composers/composer-uploads.controller';
import { ComposerUploadsService } from './composers/composer-uploads.service';
import { WorkUploadsController } from './works/work-uploads.controller';
import { WorkUploadsService } from './works/work-uploads.service';
import { ScoreUploadsController } from './scores/score-uploads.controller';
import { ScoreUploadsService } from './scores/score-uploads.service';
import { ModerationController } from './moderation/moderation.controller';
import { PortalModule } from '../portal/portal.module';
import { ModerationService } from './moderation/moderation.service';
import { ModerationSweepService } from './moderation/moderation-sweep.service';
import { UploadHistoryController } from './history/upload-history.controller';
import { UploadHistoryQueryService } from './history/upload-history-query.service';
import { UploadSupportController } from './support/upload-support.controller';
import { UploadSupportService } from './support/upload-support.service';

/**
 * Contribuição da comunidade: envio de arquivos, cadastro de compositor, obra e
 * partitura, histórico e fila de moderação.
 *
 * Importa `BillingModule` para aplicar os limites de plano (`uploadLimit`,
 * `maxPerformanceVideos`) — a regra RN-1 do ROADMAP.
 */
@Module({
  imports: [BillingModule, PortalModule],
  controllers: [
    UploadsController,
    UploadSupportController,
    UploadHistoryController,
    ModerationController,
    ComposerUploadsController,
    WorkUploadsController,
    ScoreUploadsController,
  ],
  providers: [
    UploadsService,
    UploadHistoryService,
    UploadHistoryQueryService,
    UploadSupportService,
    ModerationService,
    ModerationSweepService,
    ComposerUploadsService,
    WorkUploadsService,
    ScoreUploadsService,
  ],
  // `ModerationSweepService` é exportado porque o processor do worker o chama.
  // `ModerationService` sai daqui para o blog: a denúncia de comentário entra
  // na mesma fila (RN-4).
  exports: [
    UploadsService,
    UploadHistoryService,
    ModerationSweepService,
    ModerationService,
  ],
})
export class UploadsModule {}
