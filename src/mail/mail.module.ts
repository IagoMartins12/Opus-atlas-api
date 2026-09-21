import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * Global para que qualquer módulo de domínio (auth, portal, billing...) possa
 * disparar e-mail transacional sem reimportar o módulo — mesmo padrão do `AuthModule`.
 */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
