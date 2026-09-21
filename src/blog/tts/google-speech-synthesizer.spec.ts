import {
  BadRequestException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleSpeechSynthesizer } from './speech-synthesizer';

const synthesizeSpeech = jest.fn();
jest.mock('@google-cloud/text-to-speech', () => ({
  TextToSpeechClient: jest
    .fn()
    .mockImplementation(() => ({ synthesizeSpeech })),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TextToSpeechClient } = jest.requireMock(
  '@google-cloud/text-to-speech',
) as {
  TextToSpeechClient: jest.Mock;
};

const withCredentials = (keyFile: string | undefined) =>
  new GoogleSpeechSynthesizer({
    get: jest.fn().mockReturnValue(keyFile),
  } as unknown as ConfigService);

describe('GoogleSpeechSynthesizer', () => {
  beforeEach(() => {
    synthesizeSpeech.mockReset();
    TextToSpeechClient.mockClear();
  });

  it('pede MP3 em pt-BR com a voz escolhida, sem gênero fixo', async () => {
    synthesizeSpeech.mockResolvedValue([
      { audioContent: Uint8Array.from([1, 2, 3]) },
    ]);
    const synth = withCredentials('./.config/google-tts.json');

    await expect(
      synth.synthesize('Olá', 'pt-BR-Neural2-A', 1.1),
    ).resolves.toEqual(Buffer.from([1, 2, 3]));
    expect(synthesizeSpeech).toHaveBeenCalledWith({
      input: { text: 'Olá' },
      voice: { languageCode: 'pt-BR', name: 'pt-BR-Neural2-A' },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 1.1,
        sampleRateHertz: 24_000,
      },
    });
    expect(TextToSpeechClient).toHaveBeenCalledWith({
      keyFilename: './.config/google-tts.json',
    });
  });

  it('áudio em base64 também é aceito; o cliente é criado uma vez só', async () => {
    synthesizeSpeech.mockResolvedValue([
      { audioContent: Buffer.from('mp3').toString('base64') },
    ]);
    const synth = withCredentials('k.json');

    await synth.synthesize('a', 'v', 1);
    await expect(synth.synthesize('b', 'v', 1)).resolves.toEqual(
      Buffer.from('mp3'),
    );
    expect(TextToSpeechClient).toHaveBeenCalledTimes(1);
  });

  it('sem credencial é 503', async () => {
    await expect(
      withCredentials(undefined).synthesize('a', 'v', 1),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it.each([
    [[{ audioContent: new Uint8Array() }], ServiceUnavailableException],
    [new Error('RESOURCE_EXHAUSTED: quota'), HttpException],
    [new Error('3 INVALID_ARGUMENT: voz'), BadRequestException],
    [new Error('16 UNAUTHENTICATED'), ServiceUnavailableException],
    [new Error('qualquer outra'), ServiceUnavailableException],
  ])('traduz o erro do Google: %p', async (outcome, expected) => {
    if (outcome instanceof Error) synthesizeSpeech.mockRejectedValue(outcome);
    else synthesizeSpeech.mockResolvedValue(outcome);

    await expect(
      withCredentials('k.json').synthesize('a', 'v', 1),
    ).rejects.toBeInstanceOf(expected);
  });

  it('cota estourada é 429', async () => {
    synthesizeSpeech.mockRejectedValue(new Error('quota exceeded'));

    const error = await withCredentials('k.json')
      .synthesize('a', 'v', 1)
      .catch((e) => e);
    expect((error as HttpException).getStatus()).toBe(429);
  });
});
