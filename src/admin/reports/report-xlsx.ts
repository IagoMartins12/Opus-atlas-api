import * as ExcelJS from 'exceljs';
import { ReportCsvMeta } from './report-csv';
import { ReportData } from './report-types';

const DOURADO = 'FFB8963E';
const CINZA = 'FFF2EFE8';

const day = (date: Date) =>
  date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

/** O nome da aba: até 31 caracteres, sem `[]:*?/\`, e único no arquivo. */
function sheetName(title: string, used: Set<string>): string {
  const base =
    title
      .replace(/[[\]:*?/\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 28) || 'Tabela';
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) name = `${base.slice(0, 27)} ${n++}`;
  used.add(name.toLowerCase());
  return name;
}

/**
 * O relatório como planilha: uma aba "Resumo" (título, período, indicadores) e
 * uma aba por tabela, com cabeçalho fixo, filtro e largura de coluna pelo
 * conteúdo. Número fica número (a planilha soma e ordena), texto fica texto.
 */
export async function reportToXlsx(
  meta: ReportCsvMeta,
  data: ReportData,
): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = 'Opus Atlas';
  book.created = meta.generatedAt;
  const used = new Set<string>(['resumo']);

  const resumo = book.addWorksheet('Resumo');
  resumo.columns = [{ width: 58 }, { width: 22 }];
  resumo.addRow([meta.name]).font = { bold: true, size: 16 };
  resumo.addRow([
    'Período',
    `${meta.period} (${day(meta.start)} a ${day(meta.end)})`,
  ]);
  resumo.addRow([
    'Gerado em',
    meta.generatedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
  ]);
  resumo.addRow([]);
  const head = resumo.addRow(['Indicador', 'Valor']);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DOURADO } };
  for (const [label, value] of data.summary) {
    const row = resumo.addRow([label, value]);
    row.getCell(2).alignment = { horizontal: 'right' };
    if (typeof value === 'number')
      row.getCell(2).numFmt = Number.isInteger(value) ? '#,##0' : '#,##0.00';
  }
  resumo.addRow([]);
  resumo.addRow(['Abas', data.sections.map((s) => s.title).join(' · ')]);

  for (const section of data.sections) {
    const sheet = book.addWorksheet(sheetName(section.title, used));
    sheet.addRow([section.title]).font = { bold: true, size: 13 };
    sheet.addRow([]);
    if (section.rows.length === 0) {
      sheet.addRow(['(nenhum registro no período)']);
      continue;
    }
    const header = sheet.addRow(section.columns);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: DOURADO },
    };
    header.alignment = { vertical: 'middle', wrapText: true };
    const headerRow = header.number;

    section.rows.forEach((cells, i) => {
      const row = sheet.addRow(cells);
      if (i % 2 === 1)
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: CINZA },
        };
      row.eachCell((cell) => {
        if (typeof cell.value === 'number')
          cell.numFmt = Number.isInteger(cell.value) ? '#,##0' : '#,##0.00';
      });
    });

    section.columns.forEach((title, c) => {
      const longest = Math.max(
        title.length,
        ...section.rows.map((r) => String(r[c] ?? '').length),
      );
      sheet.getColumn(c + 1).width = Math.min(60, Math.max(10, longest + 2));
    });
    sheet.views = [{ state: 'frozen', ySplit: headerRow }];
    sheet.autoFilter = {
      from: { row: headerRow, column: 1 },
      to: { row: headerRow, column: section.columns.length },
    };
  }

  const buffer = await book.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
