import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiTextService } from './ai-text.service';

@Module({
  providers: [
    {
      provide: AiTextService,
      inject: [ConfigService],
      // Fábrica explícita: o segundo parâmetro do construtor (o `fetch`) é
      // para os testes, não um provider do Nest.
      useFactory: (config: ConfigService) => new AiTextService(config),
    },
  ],
  exports: [AiTextService],
})
export class AiModule {}
