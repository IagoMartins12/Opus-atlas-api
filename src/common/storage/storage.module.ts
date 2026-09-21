import { Global, Module } from '@nestjs/common';
import { CloudinaryService } from './cloudinary.service';
import { StorageCleanupService } from './storage-cleanup.service';
import { StorageService } from './storage.service';

/**
 * Armazenamento de arquivos (Cloudinary).
 *
 * Global porque praticamente todo módulo de domínio precisa guardar ou apagar
 * arquivo — perfil, catálogo, uploads da comunidade, portal, blog e anúncios.
 * Reimportar em cada um seria ruído sem ganho de isolamento.
 */
@Global()
@Module({
  providers: [CloudinaryService, StorageService, StorageCleanupService],
  exports: [CloudinaryService, StorageService, StorageCleanupService],
})
export class StorageModule {}
