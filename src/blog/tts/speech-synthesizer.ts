import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { errorMessage } from '../../common/utils/error.util';

/** Síntese de voz — atrás de uma interface para os testes não dependerem do Google. */
export interface SpeechSynthesizer {
  synthesize(
    text: string,
    voice: string,
    speakingRate: number,
  ): Promise<Buffer>;
}

export const SPEECH_SYNTHESIZER = Symbol('SPEECH_SYNTHESIZER');

/** Google Cloud Text-to-Speech, a mesma voz do legado. */
@Injectable()
export class GoogleSpeechSynthesizer implements SpeechSynthesizer {
  private client: TextToSpeechClient | null = null;

  constructor(private readonly config: ConfigService) {}

  async synthesize(
    text: string,
    voice: string,
    speakingRate: number,
  ): Promise<Buffer> {
    try {
      const [response] = await this.getClient().synthesizeSpeech({
        input: { text },
        // Sem `ssmlGender`: o legado mandava `MALE` fixo com a voz padrão
        // `pt-BR-Neural2-A`, que é feminina. O nome da voz já decide.
        voice: { languageCode: 'pt-BR', name: voice },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate,
          sampleRateHertz: 24_000,
        },
      });

      const audio = response.audioContent;

      if (!audio || audio.length === 0) {
        throw new Error('O Google não devolveu áudio');
      }

      return typeof audio === 'string'
        ? Buffer.from(audio, 'base64')
        : Buffer.from(audio);
    } catch (error: unknown) {
      throw translate(error);
    }
  }

  private getClient(): TextToSpeechClient {
    const keyFilename = this.config.get<string>(
      'GOOGLE_APPLICATION_CREDENTIALS',
    );

    if (!keyFilename) {
      throw new ServiceUnavailableException(
        'Texto para voz não configurado: falta GOOGLE_APPLICATION_CREDENTIALS, ' +
          'o caminho do JSON da conta de serviço do Google Cloud.',
      );
    }

    this.client ??= new TextToSpeechClient({ keyFilename });
    return this.client;
  }
}

function translate(error: unknown): Error {
  if (error instanceof HttpException) {
    return error;
  }

  const message = errorMessage(error);

  if (/quota|RESOURCE_EXHAUSTED/i.test(message)) {
    return new HttpException(
      'Limite de uso do Google TTS excedido',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  if (/INVALID_ARGUMENT/i.test(message)) {
    return new BadRequestException(`O Google recusou o pedido: ${message}`);
  }

  if (/credential|UNAUTHENTICATED|PERMISSION_DENIED|ENOENT/i.test(message)) {
    return new ServiceUnavailableException(
      'Credenciais do Google Cloud inválidas ou ausentes',
    );
  }

  return new ServiceUnavailableException(`Falha no Google TTS: ${message}`);
}
