import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScrapersModule } from './scrapers/scapers.module';
import { PrismaService } from './prisma/prisma.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScrapersModule,
  ],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
