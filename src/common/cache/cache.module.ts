import { Global, Module } from '@nestjs/common';
import { AppCacheService } from './cache.service';

/**
 * Exposto globalmente: praticamente todo módulo de leitura usa cache, e o
 * `AppCacheService` não carrega estado próprio — reimportar em cada módulo
 * seria ruído sem ganho.
 */
@Global()
@Module({
  providers: [AppCacheService],
  exports: [AppCacheService],
})
export class AppCacheModule {}
