import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { EpochsController } from './epochs.controller';
import { EpochsService } from './epochs.service';

@Module({
  imports: [PrismaModule],
  controllers: [EpochsController],
  providers: [EpochsService],
  exports: [EpochsService],
})
export class EpochsModule {}
