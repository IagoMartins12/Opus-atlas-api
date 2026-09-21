import * as cheerio from 'cheerio';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  absoluteImslpUrl,
  directFileUrl,
  parseImslpScores,
} from './imslp-scores.parser';

// Página real (Noturnos Op. 9 de Chopin), reduzida: aba de partituras inteira
// e os três primeiros grupos de arranjos.
const html = readFileSync(
  join(__dirname, '__fixtures__', 'nocturnes-op9.html'),
  'utf-8',
);

describe('parseImslpScores — página real', () => {
  const result = parseImslpScores(cheerio.load(html));
  const scores = result.scores.filter((score) => score.type === 'SCORES');
  const first = scores[0];

  it('lê os contadores das abas', () => {
    expect(result.totals).toMatchObject({
      scores: 31,
      parts: 0,
      arrangements: 86,
    });
  });

  it('lê todos os arquivos da aba de partituras', () => {
    expect(scores).toHaveLength(31);
  });

  it('monta a URL direta do PDF no espelho, sem requisição extra', () => {
    expect(first.sourceId).toBe('86550');
    expect(first.downloadUrl).toBe(
      'https://ks15.imslp.org/files/imglnks/usimg/9/91/IMSLP86550-PMLP02312-Chopin_Nocturnes_Op_9_Kistner_995_First_Edition_1832.pdf',
    );
  });

  // O legado procurava "Baixar" numa página em inglês e gravava o padrão.
  it('o título vem da página, com os genéricos traduzidos', () => {
    expect(first.title).toBe('Partitura Completa');
    expect(result.scores.map((score) => score.title)).toContain('1. Larghetto');
  });

  it('tamanho, páginas, downloads e quem enviou', () => {
    expect(first).toMatchObject({
      fileSize: '1.87MB',
      pageCount: '13',
      fileFormat: 'PDF',
      uploader: 'piupianissimo',
    });
    expect(first.downloadCount).toBeGreaterThan(100_000);
  });

  it('a ficha da edição vem do grupo', () => {
    expect(first.editor).toBe('First edition (German)');
    expect(first.publisher).toMatch(/^Leipzig: Fr\. Kistner/);
    expect(first.copyright).toBe('Public Domain');
  });

  it('a miniatura é URL absoluta, sem barras a mais', () => {
    expect(first.thumbnailUrl).toMatch(
      /^https:\/\/imslp\.org\/images\/thumb\//,
    );
  });

  it('o grupo tem o título da seção (h4, ou h5 nos arranjos)', () => {
    expect(first.groupTitle).toBe('Complete');
    const arrangement = result.scores.find(
      (score) => score.type === 'ARRANGEMENTS',
    );
    expect(arrangement?.groupTitle).toBe('For Piano 4 Hands (Horn)');
  });

  // "For Violin and Piano (Hermann)" é um `dl` com "See: …", sem arquivo.
  it('referência a outra página não vira grupo', () => {
    expect(result.scores.map((score) => score.groupTitle)).not.toContain(
      'For Violin and Piano (Hermann)',
    );
  });

  it('os grupos são numerados por aba', () => {
    expect(scores[0].groupIndex).toBe(0);
    expect(new Set(scores.map((score) => score.groupIndex)).size).toBe(29);
  });
});

describe('endereços', () => {
  // 80 mil miniaturas guardadas pelo legado estão como `https:////cdn...`.
  it('endereço sem esquema vira https, sem barras a mais', () => {
    expect(absoluteImslpUrl('//cdn.imslp.org/images/a.png')).toBe(
      'https://cdn.imslp.org/images/a.png',
    );
    expect(absoluteImslpUrl('/images/thumb/a.jpg')).toBe(
      'https://imslp.org/images/thumb/a.jpg',
    );
    expect(absoluteImslpUrl('')).toBeNull();
  });

  it('link fora do formato cai no endereço intermediário', () => {
    expect(directFileUrl('/wiki/Special:ImagefromIndex/1', '1')).toBe(
      'https://imslp.org/wiki/Special:ImagefromIndex/1',
    );
  });
});
