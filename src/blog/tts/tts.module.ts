import { Module } from '@nestjs/common';
import {
  GoogleSpeechSynthesizer,
  SPEECH_SYNTHESIZER,
} from './speech-synthesizer';
import { TtsController } from './tts.controller';
import { TtsService } from './tts.service';

@Module({
  controllers: [TtsController],
  providers: [
    TtsService,
    { provide: SPEECH_SYNTHESIZER, useClass: GoogleSpeechSynthesizer },
  ],
})
export class TtsModule {}
