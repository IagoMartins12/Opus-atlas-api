import { Global, Module } from '@nestjs/common';
import { TextIndexService } from './text-index.service';

/**
 * Índices de texto do MongoDB. Global porque qualquer módulo de busca precisa
 * consultar `hasTextIndex()` antes de escolher entre `$text` e regex.
 */
@Global()
@Module({
  providers: [TextIndexService],
  exports: [TextIndexService],
})
export class SearchModule {}
