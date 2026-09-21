import { csvRow } from '../../common/utils/csv.util';
import { ReportData } from './report-types';

export interface ReportCsvMeta {
  name: string;
  period: string;
  start: Date;
  end: Date;
  generatedAt: Date;
}

const day = (date: Date) =>
  date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

/**
 * O relatório em CSV: um cabeçalho, o resumo e uma tabela por seção,
 * separados por linha em branco — é como abre legível numa planilha.
 *
 * O legado juntava tudo numa tabela só, com a união das colunas de todas as
 * seções (a coluna "Tipo" dizia de qual era cada linha), o que deixava a
 * maioria das células vazias.
 */
export function reportToCsv(meta: ReportCsvMeta, data: ReportData): string {
  const lines: string[] = [
    csvRow(['Relatório', meta.name]),
    csvRow([
      'Período',
      `${meta.period} (${day(meta.start)} a ${day(meta.end)})`,
    ]),
    csvRow(['Gerado em', meta.generatedAt]),
    '',
    csvRow(['Resumo']),
    csvRow(['Indicador', 'Valor']),
    ...data.summary.map(([label, value]) => csvRow([label, value])),
  ];

  for (const section of data.sections) {
    lines.push('', csvRow([section.title]));

    if (section.rows.length === 0) {
      lines.push(csvRow(['(nenhum registro no período)']));
      continue;
    }

    lines.push(
      csvRow(section.columns),
      ...section.rows.map((row) => csvRow(row)),
    );
  }

  return lines.join('\r\n');
}
