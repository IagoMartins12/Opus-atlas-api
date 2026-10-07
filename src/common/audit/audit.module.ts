import { Global, Module } from '@nestjs/common';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';
import { AuditSnapshotService } from './audit-snapshot.service';

/**
 * Auditoria de ações administrativas. Global porque `@Audited()` precisa
 * funcionar em qualquer módulo sem reimport — em especial no `AdminModule`,
 * onde toda rota é auditável por padrão.
 */
@Global()
@Module({
  providers: [AuditService, AuditSnapshotService, AuditInterceptor],
  exports: [AuditService, AuditSnapshotService, AuditInterceptor],
})
export class AuditModule {}
