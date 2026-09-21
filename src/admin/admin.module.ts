import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { AdminAdsController } from './ads/admin-ads.controller';
import { AdminAdsService } from './ads/admin-ads.service';
import { AdminBillingController } from './billing/admin-billing.controller';
import { AdminBillingService } from './billing/admin-billing.service';
import { AdminCatalogMetricsService } from './catalog/admin-catalog-metrics.service';
import { AdminMetricsController } from './metrics/admin-metrics.controller';
import { AdminMetricsService } from './metrics/admin-metrics.service';
import { AudienceInsightsService } from './metrics/audience-insights.service';
import { CatalogInsightsService } from './metrics/catalog-insights.service';
import { LearningInsightsService } from './metrics/learning-insights.service';
import { MonetizationInsightsService } from './metrics/monetization-insights.service';
import { PlatformOverviewService } from './metrics/platform-overview.service';
import { AdminReportsController } from './reports/admin-reports.controller';
import { AdminReportsService } from './reports/admin-reports.service';
import { ReportDataService } from './reports/report-data.service';
import { TeachingInsightsService } from './metrics/teaching-insights.service';
import { AdminNewsletterController } from './newsletter/admin-newsletter.controller';
import { AdminAuditService } from './operations/admin-audit.service';
import { AdminDatabaseController } from './database/admin-database.controller';
import { AdminDatabaseService } from './database/admin-database.service';
import { ModelRegistry } from './database/model-registry';
import { AdminMaintenanceController } from './maintenance/admin-maintenance.controller';
import { AdminMaintenanceService } from './maintenance/admin-maintenance.service';
import { MaintenanceTasksService } from './maintenance/maintenance-tasks.service';
import { AdminBackupController } from './backup/admin-backup.controller';
import { BackupService } from './backup/backup.service';
import { BackupSettingsService } from './backup/backup-settings.service';
import { BackupHistoryService } from './backup/backup-history.service';
import { BackupStorageService } from './backup/backup-storage.service';
import { SystemHealthService } from './maintenance/system-health.service';
import { AdminJobsController } from './operations/admin-jobs.controller';
import { AdminOperationsController } from './operations/admin-operations.controller';
import { AdminTemplatesController } from './newsletter/admin-templates.controller';
import { AdminTemplatesService } from './newsletter/admin-templates.service';
import { AdminNewsletterService } from './newsletter/admin-newsletter.service';
import { EmailEventsController } from './newsletter/events/email-events.controller';
import { EmailEventsService } from './newsletter/events/email-events.service';
import { NewsletterDispatchService } from './newsletter/newsletter-dispatch.service';
import { AdminCatalogController } from './catalog/admin-catalog.controller';
import { AdminCatalogService } from './catalog/admin-catalog.service';
import { WorkCountFiltersService } from './catalog/work-count-filters.service';
import { AdminUploadsController } from './uploads/admin-uploads.controller';
import { AdminUploadsService } from './uploads/admin-uploads.service';
import { AdminUsersController } from './users/admin-users.controller';
import { AdminUsersService } from './users/admin-users.service';
import { TeacherInvitationService } from './users/teacher-invitation.service';
import { TeacherInvitationsController } from './users/teacher-invitations.controller';

/**
 * Área administrativa.
 *
 * Todas as rotas exigem papel administrativo pelo `@Roles()` do controller, e
 * toda escrita relevante é marcada com `@Audited()` — a infraestrutura de
 * auditoria existe desde a Etapa 0 e é aqui que passa a ser usada de fato.
 *
 * O módulo cresce por área (usuários, catálogo, moderação, anúncios, cobrança,
 * newsletter, métricas, operação), cada uma num diretório próprio, para não
 * repetir o arquivo de 2.259 linhas que o legado tinha em `admin/insights`.
 */
@Module({
  // `MailModule` entra pelo envio de prévia e pelo disparo de campanha;
  // `AuthModule` pelo `UserTokenService`, que emite o link de descadastro.
  imports: [MailModule, AuthModule],
  controllers: [
    EmailEventsController,
    AdminUsersController,
    TeacherInvitationsController,
    AdminCatalogController,
    AdminUploadsController,
    AdminAdsController,
    AdminBillingController,
    AdminNewsletterController,
    AdminTemplatesController,
    AdminMetricsController,
    AdminReportsController,
    AdminOperationsController,
    AdminJobsController,
    AdminMaintenanceController,
    AdminBackupController,
    AdminDatabaseController,
  ],
  providers: [
    AdminUsersService,
    TeacherInvitationService,
    AdminCatalogService,
    AdminCatalogMetricsService,
    WorkCountFiltersService,
    AdminUploadsService,
    AdminAdsService,
    AdminBillingService,
    AdminNewsletterService,
    EmailEventsService,
    NewsletterDispatchService,
    AdminTemplatesService,
    AdminMetricsService,
    PlatformOverviewService,
    CatalogInsightsService,
    LearningInsightsService,
    AudienceInsightsService,
    TeachingInsightsService,
    MonetizationInsightsService,
    AdminReportsService,
    ReportDataService,
    AdminAuditService,
    AdminMaintenanceService,
    MaintenanceTasksService,
    BackupService,
    BackupSettingsService,
    BackupHistoryService,
    BackupStorageService,
    SystemHealthService,
    ModelRegistry,
    AdminDatabaseService,
  ],
  // Exportados para o `WorkerModule`: os processors são adaptadores finos e
  // chamam estes serviços.
  exports: [NewsletterDispatchService, MaintenanceTasksService],
})
export class AdminModule {}
