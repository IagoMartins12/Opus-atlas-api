import { detectFileType, isMimeAllowed } from './file-signature';

/** Monta um buffer com a assinatura no início e lixo no resto. */
const withSignature = (bytes: number[], padding = 32): Buffer =>
  Buffer.concat([Buffer.from(bytes), Buffer.alloc(padding, 0x41)]);

const ascii = (text: string, offset = 0): number[] => {
  const prefix = Array<number>(offset).fill(0x00);
  return [...prefix, ...Array.from(text, (char) => char.charCodeAt(0))];
};

describe('detectFileType', () => {
  it('reconhece JPEG', () => {
    expect(detectFileType(withSignature([0xff, 0xd8, 0xff, 0xe0]))).toEqual({
      mimeType: 'image/jpeg',
      extension: 'jpg',
    });
  });

  it('reconhece PNG', () => {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    expect(detectFileType(withSignature(png))?.mimeType).toBe('image/png');
  });

  it('reconhece GIF nas duas versões', () => {
    expect(detectFileType(withSignature(ascii('GIF87a')))?.mimeType).toBe(
      'image/gif',
    );
    expect(detectFileType(withSignature(ascii('GIF89a')))?.mimeType).toBe(
      'image/gif',
    );
  });

  it('reconhece PDF', () => {
    expect(detectFileType(withSignature(ascii('%PDF-1.7')))?.mimeType).toBe(
      'application/pdf',
    );
  });

  // WEBP e WAV são ambos contêineres RIFF e só se distinguem no byte 8.
  it('separa WEBP de WAV, que compartilham o prefixo RIFF', () => {
    const webp = Buffer.concat([
      Buffer.from(ascii('RIFF')),
      Buffer.alloc(4, 0x00),
      Buffer.from(ascii('WEBP')),
      Buffer.alloc(16, 0x00),
    ]);
    const wav = Buffer.concat([
      Buffer.from(ascii('RIFF')),
      Buffer.alloc(4, 0x00),
      Buffer.from(ascii('WAVE')),
      Buffer.alloc(16, 0x00),
    ]);

    expect(detectFileType(webp)?.mimeType).toBe('image/webp');
    expect(detectFileType(wav)?.mimeType).toBe('audio/wav');
  });

  it('reconhece MP4 pelo marcador ftyp no offset 4', () => {
    const mp4 = Buffer.concat([
      Buffer.alloc(4, 0x00),
      Buffer.from(ascii('ftypisom')),
      Buffer.alloc(16, 0x00),
    ]);

    expect(detectFileType(mp4)?.mimeType).toBe('video/mp4');
  });

  it('reconhece WEBM', () => {
    expect(
      detectFileType(withSignature([0x1a, 0x45, 0xdf, 0xa3]))?.mimeType,
    ).toBe('video/webm');
  });

  it('reconhece MP3 com e sem tag ID3', () => {
    expect(detectFileType(withSignature(ascii('ID3')))?.mimeType).toBe(
      'audio/mpeg',
    );
    expect(detectFileType(withSignature([0xff, 0xfb]))?.mimeType).toBe(
      'audio/mpeg',
    );
  });

  it('reconhece OGG', () => {
    expect(detectFileType(withSignature(ascii('OggS')))?.mimeType).toBe(
      'audio/ogg',
    );
  });

  // O caso que motiva a checagem: extensão e Content-Type são do cliente.
  it('recusa um executável renomeado para .png', () => {
    // "MZ" é o cabeçalho de um executável do Windows.
    expect(detectFileType(withSignature(ascii('MZ')))).toBeNull();
  });

  it('recusa arquivo vazio ou curto demais', () => {
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
    expect(detectFileType(Buffer.from([0xff]))).toBeNull();
  });

  it('recusa conteúdo de texto puro', () => {
    expect(
      detectFileType(Buffer.from('não sou uma imagem', 'utf8')),
    ).toBeNull();
  });
});

describe('isMimeAllowed', () => {
  const jpeg = { mimeType: 'image/jpeg', extension: 'jpg' };
  const mp4 = { mimeType: 'video/mp4', extension: 'mp4' };
  const wav = { mimeType: 'audio/wav', extension: 'wav' };

  it('aceita correspondência direta', () => {
    expect(isMimeAllowed(jpeg, ['image/jpeg', 'image/png'])).toBe(true);
  });

  it('recusa tipo fora da lista', () => {
    expect(isMimeAllowed(jpeg, ['application/pdf'])).toBe(false);
  });

  // Um .mov de iPhone e um .mp4 são o mesmo contêiner ISO-BMFF. Recusar um
  // vídeo legítimo por causa do rótulo seria falso positivo, não segurança.
  it('aceita quicktime quando o detectado é mp4', () => {
    expect(isMimeAllowed(mp4, ['video/quicktime'])).toBe(true);
  });

  it('aceita audio/mp4 na mesma família ISO-BMFF', () => {
    expect(isMimeAllowed(mp4, ['audio/mp4'])).toBe(true);
  });

  it('aceita a grafia alternativa audio/x-wav', () => {
    expect(isMimeAllowed(wav, ['audio/x-wav'])).toBe(true);
  });

  it('não cruza famílias diferentes', () => {
    expect(isMimeAllowed(mp4, ['audio/mpeg', 'image/png'])).toBe(false);
  });
});
