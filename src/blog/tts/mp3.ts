/**
 * Junta os pedaços de MP3 que o Google devolve.
 *
 * **O legado usava o ffmpeg** — que precisa estar instalado no servidor, e a
 * falta dele virava "erro ao concatenar áudios". MP3 é uma sequência de
 * quadros independentes: juntar os bytes de dois arquivos dá um arquivo válido,
 * desde que as etiquetas ID3 do meio saiam. É o que se faz aqui.
 *
 * A premissa é que o MP3 do Google não traz cabeçalho de duração (Xing/Info)
 * — com ele, alguns tocadores mostrariam a duração só do primeiro pedaço.
 */

/** Tira a etiqueta ID3v2 do começo e a ID3v1 do fim, se houver. */
export function stripId3(buffer: Buffer): Buffer {
  let start = 0;
  let end = buffer.length;

  if (buffer.length >= 10 && buffer.toString('latin1', 0, 3) === 'ID3') {
    // Tamanho "synchsafe": 4 bytes de 7 bits cada.
    const size =
      ((buffer[6] & 0x7f) << 21) |
      ((buffer[7] & 0x7f) << 14) |
      ((buffer[8] & 0x7f) << 7) |
      (buffer[9] & 0x7f);
    const hasFooter = (buffer[5] & 0x10) !== 0;
    start = Math.min(buffer.length, 10 + size + (hasFooter ? 10 : 0));
  }

  if (
    end - start >= 128 &&
    buffer.toString('latin1', end - 128, end - 125) === 'TAG'
  ) {
    end -= 128;
  }

  return buffer.subarray(start, end);
}

export function concatMp3(buffers: Buffer[]): Buffer {
  if (buffers.length === 1) {
    return buffers[0];
  }

  return Buffer.concat(buffers.map(stripId3));
}

/**
 * O identificador de um arquivo do Cloudinary, a partir do endereço.
 *
 * **O legado errava a conta**: `split('/').slice(-2)` sobre
 * `…/upload/v123/blog/tts/<artigo>/tts_audio.mp3` dava `<artigo>/tts_audio`,
 * sem o `blog/tts/` do começo. A remoção apontava para um arquivo que não
 * existe, e todo áudio regerado deixava o anterior no Cloudinary para sempre.
 */
export function cloudinaryPublicId(url: string): string | null {
  const match = url.match(
    /^https:\/\/res\.cloudinary\.com\/[^/]+\/[a-z]+\/upload\/(?:[^/]+\/)*?(?:v\d+\/)?(.+?)\.[a-z0-9]+$/i,
  );

  return match ? match[1] : null;
}
