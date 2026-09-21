import { Module } from '@nestjs/common';
import { AiModule } from '../../ai/ai.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ComposerBioService } from './composer-bio.service';
import { ComposersController } from './composers.controller';
import { ComposersService } from './composers.service';

@Module({
  imports: [PrismaModule, AiModule],
  controllers: [ComposersController],
  providers: [ComposersService, ComposerBioService],
  exports: [ComposersService],
})
export class ComposersModule {}
