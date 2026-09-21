import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { AssignmentsController } from './assignments/assignments.controller';
import { AssignmentsService } from './assignments/assignments.service';
import { AvailabilityController } from './availability/availability.controller';
import { AvailabilityService } from './availability/availability.service';
import { CalendarController } from './calendar/calendar.controller';
import { CalendarService } from './calendar/calendar.service';
import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { PortalProfileService } from './profile/profile.service';
import { PeerComparisonService } from './reports/peer-comparison.service';
import { ProgressReportService } from './reports/progress-report.service';
import { ReportSectionsService } from './reports/report-sections.service';
import { ReportsController } from './reports/reports.controller';
import { SharedReportsService } from './reports/shared-reports.service';
import { SchoolActivitiesController } from './school-activities/school-activities.controller';
import { SchoolActivitiesService } from './school-activities/school-activities.service';
import { MailModule } from '../mail/mail.module';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { NotificationSweepService } from './notifications/notification-sweep.service';
import { LessonsController } from './lessons/lessons.controller';
import { LessonSchedulingService } from './lessons/lesson-scheduling.service';
import { LessonsService } from './lessons/lessons.service';
import { RelationshipsController } from './relationships/relationships.controller';
import { RelationshipsService } from './relationships/relationships.service';

/**
 * Portal do aluno e do professor.
 *
 * `NotificationsService` é exportado porque todo o resto do portal notifica:
 * aula agendada, tarefa criada, feedback dado. Manter a emissão num serviço só
 * evita que cada módulo monte o registro de notificação do seu jeito, que foi
 * o que aconteceu no legado.
 */
@Module({
  // `BillingModule` entra pelo limite de alunos do plano (RN-1) — a mesma
  // razão pela qual o módulo de uploads o importa.
  imports: [AuthModule, MailModule, BillingModule],
  controllers: [
    NotificationsController,
    RelationshipsController,
    LessonsController,
    AssignmentsController,
    CalendarController,
    AvailabilityController,
    DashboardController,
    ReportsController,
    SchoolActivitiesController,
  ],
  providers: [
    NotificationsService,
    NotificationSweepService,
    RelationshipsService,
    LessonsService,
    LessonSchedulingService,
    AssignmentsService,
    CalendarService,
    AvailabilityService,
    DashboardService,
    PortalProfileService,
    ReportSectionsService,
    PeerComparisonService,
    ProgressReportService,
    SharedReportsService,
    SchoolActivitiesService,
  ],
  exports: [
    NotificationsService,
    // Exportado para o `WorkerModule`: o processor da fila de notificações é
    // um adaptador fino e chama este serviço.
    NotificationSweepService,
    RelationshipsService,
    LessonsService,
    AssignmentsService,
    // Exportado para o módulo de perfil: `GET`/`PATCH /profile` montam as
    // seções de professor e de aluno com ele.
    PortalProfileService,
  ],
})
export class PortalModule {}
