import { Module } from '@nestjs/common';
import { ComposersModule } from '../../catalog/composers/composers.module';
import { WorksModule } from '../../catalog/works/works.module';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';

@Module({
  imports: [ComposersModule, WorksModule],
  controllers: [CollectionsController],
  providers: [CollectionsService],
  exports: [CollectionsService],
})
export class CollectionsModule {}
