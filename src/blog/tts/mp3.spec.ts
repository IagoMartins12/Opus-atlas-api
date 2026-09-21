import { cloudinaryPublicId, concatMp3, stripId3 } from './mp3';

const frames = (byte: number, length = 20) => Buffer.alloc(length, byte);

function withId3v2(body: Buffer, tagSize = 5): Buffer {
  const header = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, tagSize]);
  return Buffer.concat([header, Buffer.alloc(tagSize, 0x55), body]);
}

describe('stripId3', () => {
  it('tira a etiqueta ID3v2 do começo', () => {
    expect(stripId3(withId3v2(frames(0xff)))).toEqual(frames(0xff));
  });

  it('tira a etiqueta ID3v1 do fim', () => {
    const tag = Buffer.concat([
      Buffer.from('TAG', 'latin1'),
      Buffer.alloc(125),
    ]);
    const body = frames(0xff, 200);

    expect(stripId3(Buffer.concat([body, tag]))).toEqual(body);
  });

  it('sem etiqueta, fica como está', () => {
    expect(stripId3(frames(0xff))).toEqual(frames(0xff));
  });
});

describe('concatMp3', () => {
  it('um pedaço só volta intacto', () => {
    const only = withId3v2(frames(0xff));
    expect(concatMp3([only])).toBe(only);
  });

  it('junta os quadros sem as etiquetas do meio', () => {
    const result = concatMp3([
      withId3v2(frames(0xaa)),
      withId3v2(frames(0xbb)),
    ]);

    expect(result).toEqual(Buffer.concat([frames(0xaa), frames(0xbb)]));
  });
});

describe('cloudinaryPublicId', () => {
  // Um dos três áudios da base.
  it('mantém o caminho inteiro — o legado perdia o blog/tts/ do começo', () => {
    expect(
      cloudinaryPublicId(
        'https://res.cloudinary.com/dikufxgpb/video/upload/v1761768436/blog/tts/690273c1ecac0fb66b3844e7/tts_audio_1761768434866.mp3',
      ),
    ).toBe('blog/tts/690273c1ecac0fb66b3844e7/tts_audio_1761768434866');
  });

  it('endereço de fora do Cloudinary não tem identificador', () => {
    expect(cloudinaryPublicId('https://example.com/a.mp3')).toBeNull();
  });
});
