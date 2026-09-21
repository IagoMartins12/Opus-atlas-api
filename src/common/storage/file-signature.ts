/**
 * Detecção de tipo de arquivo pelos bytes iniciais (magic bytes).
 *
 * A extensão e o `Content-Type` do multipart são informados pelo cliente e
 * podem ser qualquer coisa: renomear `payload.exe` para `foto.png` engana os
 * dois. Ler a assinatura real do arquivo é a única checagem que o cliente não
 * controla.
 *
 * Escrito à mão de propósito. As bibliotecas usuais (`file-type`) são ESM-only
 * nas versões atuais e não importam num projeto CommonJS como este, e o
 * conjunto de formatos que a plataforma aceita é pequeno e estável.
 */

export interface DetectedFileType {
  mimeType: string;
  extension: string;
}

type Matcher = (buffer: Buffer) => boolean;

interface Signature {
  mimeType: string;
  extension: string;
  matches: Matcher;
}

/** Compara bytes a partir de um deslocamento. */
const startsWith = (bytes: number[], offset = 0): Matcher => {
  return (buffer: Buffer) => {
    if (buffer.length < offset + bytes.length) {
      return false;
    }

    return bytes.every((byte, index) => buffer[offset + index] === byte);
  };
};

/** Compara texto ASCII a partir de um deslocamento. */
const asciiAt = (text: string, offset: number): Matcher => {
  const bytes = Array.from(text, (char) => char.charCodeAt(0));
  return startsWith(bytes, offset);
};

const and =
  (...matchers: Matcher[]): Matcher =>
  (buffer: Buffer) =>
    matchers.every((matcher) => matcher(buffer));

const or =
  (...matchers: Matcher[]): Matcher =>
  (buffer: Buffer) =>
    matchers.some((matcher) => matcher(buffer));

/**
 * Ordem importa: contêineres RIFF (WEBP e WAV) compartilham os 4 primeiros
 * bytes e só se distinguem pelos bytes 8 a 11.
 */
const SIGNATURES: Signature[] = [
  {
    mimeType: 'image/jpeg',
    extension: 'jpg',
    matches: startsWith([0xff, 0xd8, 0xff]),
  },
  {
    mimeType: 'image/png',
    extension: 'png',
    matches: startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    mimeType: 'image/gif',
    extension: 'gif',
    matches: or(asciiAt('GIF87a', 0), asciiAt('GIF89a', 0)),
  },
  {
    mimeType: 'image/webp',
    extension: 'webp',
    matches: and(asciiAt('RIFF', 0), asciiAt('WEBP', 8)),
  },
  {
    mimeType: 'application/pdf',
    extension: 'pdf',
    matches: asciiAt('%PDF', 0),
  },
  {
    mimeType: 'audio/wav',
    extension: 'wav',
    matches: and(asciiAt('RIFF', 0), asciiAt('WAVE', 8)),
  },
  {
    mimeType: 'audio/ogg',
    extension: 'ogg',
    matches: asciiAt('OggS', 0),
  },
  {
    mimeType: 'audio/mpeg',
    extension: 'mp3',
    matches: or(
      asciiAt('ID3', 0),
      // Frame MPEG sem tag ID3.
      (buffer) =>
        buffer.length > 1 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0,
    ),
  },
  {
    mimeType: 'video/webm',
    extension: 'webm',
    // WEBM e MKV usam o mesmo contêiner EBML.
    matches: startsWith([0x1a, 0x45, 0xdf, 0xa3]),
  },
  {
    mimeType: 'video/mp4',
    extension: 'mp4',
    // Família ISO-BMFF: MP4, M4A e MOV têm "ftyp" no offset 4.
    matches: asciiAt('ftyp', 4),
  },
];

/**
 * Quantos bytes bastam para decidir. `WAVE` termina no byte 11, então 32 dá
 * folga sem precisar carregar o arquivo inteiro em memória.
 */
export const SIGNATURE_SAMPLE_BYTES = 32;

/** Devolve o tipo real do arquivo, ou `null` se nenhuma assinatura casar. */
export function detectFileType(buffer: Buffer): DetectedFileType | null {
  const signature = SIGNATURES.find((candidate) => candidate.matches(buffer));

  if (!signature) {
    return null;
  }

  return { mimeType: signature.mimeType, extension: signature.extension };
}

/**
 * Famílias equivalentes: formatos cujo contêiner é o mesmo e que a detecção
 * por assinatura não consegue (nem precisa) separar.
 *
 * Um `.mov` gravado por iPhone e um `.mp4` são ambos ISO-BMFF; um `.m4a` é o
 * mesmo contêiner com faixa só de áudio. Rejeitar um vídeo de performance
 * legítimo porque o navegador anunciou `video/quicktime` seria um falso
 * positivo, não segurança.
 */
const EQUIVALENT_MIMES: Record<string, readonly string[]> = {
  'video/mp4': ['video/mp4', 'video/quicktime', 'audio/mp4'],
  'video/webm': ['video/webm', 'video/x-matroska'],
  'audio/wav': ['audio/wav', 'audio/x-wav'],
  'image/jpeg': ['image/jpeg', 'image/jpg'],
};

/** Diz se o tipo detectado atende a uma das entradas da allowlist. */
export function isMimeAllowed(
  detected: DetectedFileType,
  allowed: readonly string[],
): boolean {
  if (allowed.includes(detected.mimeType)) {
    return true;
  }

  const family = EQUIVALENT_MIMES[detected.mimeType] ?? [];
  return family.some((mime) => allowed.includes(mime));
}
