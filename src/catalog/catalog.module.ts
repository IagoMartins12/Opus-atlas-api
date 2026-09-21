import { Module } from '@nestjs/common';
import { ComposersModule } from './composers/composers.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { EpochsModule } from './epochs/epochs.module';
import { InstrumentsModule } from './instruments/instruments.module';
import { WorksModule } from './works/works.module';

/**
 * Módulo "core" do domínio de catálogo (compositores, obras, épocas,
 * instrumentos, descoberta/home). É o único módulo de domínio que pode ser
 * importado livremente por outros módulos (ver seção 3.1 do SPEC.md — regras
 * de dependência entre módulos).
 */
@Module({
  imports: [
    WorksModule,
    ComposersModule,
    EpochsModule,
    InstrumentsModule,
    DiscoveryModule,
  ],
  exports: [WorksModule, ComposersModule, EpochsModule, InstrumentsModule],
})
export class CatalogModule {}
