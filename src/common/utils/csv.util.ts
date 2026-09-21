/**
 * Caracteres que fazem uma planilha tratar o campo como fórmula.
 *
 * O nome de uma aula ou tarefa é texto que o usuário escreve. Um título como
 * `=HYPERLINK("http://exemplo","clique")` vira link executável quando o arquivo
 * é aberto no Excel ou no Google Sheets — a exportação do legado escrevia o
 * valor cru, então quem abrisse o CSV rodava o que o outro lado tivesse escrito.
 */
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Escapa um campo para CSV.
 *
 * Duas correções sobre o legado, que fazia apenas `"${campo}"`:
 *
 * 1. **Aspas internas são duplicadas.** Sem isso, um título com `"` encerra o
 *    campo no meio e desalinha todas as colunas da linha em diante.
 * 2. **Prefixo de fórmula é neutralizado** com um apóstrofo à frente, que a
 *    planilha entende como "isto é texto".
 */
export function csvField(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : value instanceof Date
        ? value.toISOString()
        : String(value);

  const safe = FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix))
    ? `'${text}`
    : text;

  return `"${safe.replace(/"/g, '""')}"`;
}

export function csvRow(fields: unknown[]): string {
  return fields.map(csvField).join(',');
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [csvRow(headers), ...rows.map(csvRow)].join('\r\n');
}
