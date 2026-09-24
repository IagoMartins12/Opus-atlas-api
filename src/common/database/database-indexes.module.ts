import { Global, Module } from '@nestjs/common';
import { PartialUniqueIndexesService } from './partial-unique-indexes.service';

/**
 * Índices que o `prisma db push` não sabe criar — hoje, os únicos parciais.
 *
 * **Global e sem dono.** Antes isto vivia no módulo da newsletter, porque foi
 * lá que o problema apareceu primeiro; o resultado é que `payments` e `User`,
 * com o mesmo defeito, ficaram de fora por dois anos. Índice de banco não é
 * assunto de um módulo de produto.
 */
@Global()
@Module({
  providers: [PartialUniqueIndexesService],
  exports: [PartialUniqueIndexesService],
})
export class DatabaseIndexesModule {}
