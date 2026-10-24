import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { PortalModule } from '../portal/portal.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { PersonalDataExportService } from './export/personal-data-export.service';

/**
 * Perfil do usuário logado — uma rota de leitura e uma de escrita para tudo o
 * que é dele. As seções de professor e de aluno vêm do portal.
 */
@Module({
  imports: [PortalModule, BillingModule],
  controllers: [ProfileController],
  providers: [ProfileService, PersonalDataExportService],
})
export class ProfileModule {}
