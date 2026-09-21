import { Module } from '@nestjs/common';
import { RevalidationService } from './revalidation.service';

/**
 * Aviso de dado novo ao front (Etapa 1.7). Sem controller: escuta o evento de
 * limpeza de cache e fala com o Next.
 */
@Module({
  providers: [RevalidationService],
})
export class RevalidationModule {}
