import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // ✅ Torna disponível globalmente
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
