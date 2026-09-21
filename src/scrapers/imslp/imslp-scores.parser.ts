import { IMSLPScoreType } from '@prisma/client';
import { CheerioDocument } from './imslp-work.parser';

/**
 * Leitura das partituras de uma página de obra do IMSLP.
 *
 * **Uma página traz todos os arquivos.** O legado carregava aos pedaços (5 por
 * aba, depois mais 20) porque resolvia o endereço de cada PDF com uma
 * requisição extra — até sete espelhos testados com `HEAD` por arquivo. Aqui o
 * endereço é montado: o link escondido `/images/9/91/<arquivo>` vira
 * `https://ks15.imslp.org/files/imglnks/usimg/9/91/IMSLP<id>-<arquivo>`, o
 * espelho de 96% das 92 mil partituras já guardadas. Uma requisição por obra,
 * em vez de dezenas.
 *
 * **O título vem da página.** O legado procurava o texto "Baixar" — a interface
 * em português — e a página vem em inglês; por isso toda partitura guardada se
 * chamava "Partitura Completa", o título padrão. Os rótulos genéricos mais
 * comuns são traduzidos; os específicos ("1. Larghetto") ficam como estão.
 */

/** Aba da página → tipo da partitura. */
export const IMSLP_SCORE_TABS: ReadonlyArray<[string, IMSLPScoreType]> = [
  ['tabScore1', IMSLPScoreType.SCORES],
  ['tabScore3', IMSLPScoreType.PARTS],
  ['tabArrTrans', IMSLPScoreType.ARRANGEMENTS],
  ['tabScore4', IMSLPScoreType.LIBRETTOS],
  ['tabScore5', IMSLPScoreType.OTHERS],
  ['tabScore6', IMSLPScoreType.SOURCES],
];

/** O espelho de 96% das partituras guardadas. */
export const IMSLP_FILE_MIRROR = 'ks15.imslp.org';

const DEFAULT_TITLE: Record<IMSLPScoreType, string> = {
  SCORES: 'Partitura Completa',
  PARTS: 'Parte Individual',
  ARRANGEMENTS: 'Arranjo',
  LIBRETTOS: 'Libreto',
  OTHERS: 'Outro Material',
  SOURCES: 'Arquivo Fonte',
};

/** Rótulos genéricos do IMSLP, traduzidos; o resto fica como a página diz. */
const GENERIC_TITLES: Record<string, string> = {
  'complete score': 'Partitura Completa',
  'full score': 'Partitura Completa',
  score: 'Partitura',
  complete: 'Completa',
  'piano score': 'Partitura para Piano',
  'vocal score': 'Redução para Canto',
  'complete parts': 'Partes Completas',
  parts: 'Partes',
  libretto: 'Libreto',
  cover: 'Capa',
};

export interface ParsedImslpScore {
  sourceId: string;
  type: IMSLPScoreType;
  title: string;
  groupIndex: number;
  groupTitle: string;
  downloadUrl: string;
  thumbnailUrl: string | null;
  fileSize: string | null;
  pageCount: string | null;
  fileFormat: string;
  downloadCount: number | null;
  uploader: string | null;
  editor: string | null;
  publisher: string | null;
  copyright: string | null;
}

export interface ParsedImslpScores {
  workTitle: string | null;
  /** O que cada aba diz ter — o mesmo formato de `imslpTotalCounts`. */
  totals: Record<string, number>;
  scores: ParsedImslpScore[];
}

const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Endereço de imagem do IMSLP como URL absoluta. */
export function absoluteImslpUrl(
  raw: string | undefined | null,
): string | null {
  const value = raw?.trim();

  if (!value) return null;
  // `//cdn.imslp.org/...` — o legado fazia `https://` + isso e gravava
  // `https:////cdn...`, com barras demais.
  if (value.startsWith('//')) return `https:${value}`;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `https://imslp.org${value}`;
  return `https://${value}`;
}

/** `/images/9/91/arquivo.pdf` + `86550` → URL direta do arquivo no espelho. */
export function directFileUrl(hiddenLink: string, sourceId: string): string {
  const match = /^\/images\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(hiddenLink);

  if (!match) {
    // Formato inesperado: o endereço intermediário ainda leva ao arquivo.
    return `https://imslp.org${hiddenLink}`;
  }

  const [, folder1, folder2, filename] = match;
  return `https://${IMSLP_FILE_MIRROR}/files/imglnks/usimg/${folder1}/${folder2}/IMSLP${sourceId}-${filename}`;
}

function translateTitle(title: string, type: IMSLPScoreType): string {
  const text = clean(title);
  if (!text) return DEFAULT_TITLE[type];
  return GENERIC_TITLES[text.toLowerCase()] ?? text;
}

/** Campo da ficha da edição (`<th>Editor</th><td>…</td>`). */
function editionField(
  $: CheerioDocument,
  $group: ReturnType<CheerioDocument>,
  label: string,
): string | null {
  let value: string | null = null;

  $group.find('tr').each((_, row) => {
    const $row = $(row);
    if (clean($row.children('th').first().text()) === label) {
      value = clean($row.children('td').first().text()).replace(
        /\s*\[tag\/del\]$/,
        '',
      );
      return false;
    }
    return undefined;
  });

  return value || null;
}

export function parseImslpScores($: CheerioDocument): ParsedImslpScores {
  const totals: Record<string, number> = {};
  const scores: ParsedImslpScore[] = [];

  for (const [tabId, type] of IMSLP_SCORE_TABS) {
    totals[type.toLowerCase()] =
      Number.parseInt($(`#${tabId}_ct`).text(), 10) || 0;

    const $tab = $(`#${tabId}`);
    let section: string | null = null;
    let subsection: string | null = null;
    let groupIndex = 0;

    $tab.children().each((_, element) => {
      const $element = $(element);

      if ($element.is('h4')) {
        section = clean($element.text()) || null;
        subsection = null;
        return;
      }

      if ($element.is('h5')) {
        subsection = clean($element.text()) || null;
        return;
      }

      if (!$element.is('.we')) return;

      const $group = $element;
      const thumbnail = $group.find('img').first();
      const thumbnailUrl = absoluteImslpUrl(
        thumbnail.attr('data-src') ?? thumbnail.attr('src'),
      );
      const editor = editionField($, $group, 'Editor');
      const publisher = editionField($, $group, 'Publisher. Info.');
      const copyright = editionField($, $group, 'Copyright');
      const files: ParsedImslpScore[] = [];

      $group.find('[id^="IMSLP"]').each((_, file) => {
        const $file = $(file);
        const sourceId = ($file.attr('id') ?? '').replace(/^IMSLP/, '');
        const $download = $file.find('.we_file_download').first();
        const hiddenLink = $download
          .find('.we_file_info2 .hidden a')
          .attr('href');

        if (!/^\d+$/.test(sourceId) || !hiddenLink) return;

        const info = clean($download.find('.we_file_info2').text());
        const size = /(\d+(?:\.\d+)?)\s*(MB|KB)/i.exec(info);
        const pages = /(\d+)\s*pp\./.exec(info);
        const downloads = /([\d,]+)\s*×/.exec(info);
        const segments = info.split(' - ');
        const extension = /\.([a-z0-9]+)$/i.exec(hiddenLink)?.[1];

        files.push({
          sourceId,
          type,
          title: translateTitle(
            $download.find('span[title="Download this file"]').first().text(),
            type,
          ),
          groupIndex,
          groupTitle: '',
          downloadUrl: directFileUrl(hiddenLink, sourceId),
          thumbnailUrl,
          fileSize: size ? `${size[1]}${size[2].toUpperCase()}` : null,
          pageCount: pages ? pages[1] : null,
          fileFormat: (extension ?? 'pdf').toUpperCase(),
          downloadCount: downloads
            ? Number.parseInt(downloads[1].replace(/,/g, ''), 10)
            : null,
          // O último trecho da linha de informação é quem enviou.
          uploader:
            segments.length > 1 ? clean(segments[segments.length - 1]) : null,
          editor,
          publisher,
          copyright,
        });
      });

      if (files.length === 0) return;

      const groupTitle =
        subsection ?? section ?? files[0]?.title ?? DEFAULT_TITLE[type];

      files.forEach((file) => scores.push({ ...file, groupTitle }));
      groupIndex++;
    });
  }

  return {
    workTitle: clean($('#firstHeading').text()) || null,
    totals,
    scores,
  };
}
