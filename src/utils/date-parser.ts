// scripts/utils/date-parser.ts

/**
 * Parse datas em português para formato ISO
 * Exemplos: "qua., 5 de novembro de 2025", "sáb., 7 de dezembro de 2025, 20h30"
 */
export function parseDatePortuguese(dateString: string): Date | null {
  try {
    const months: { [key: string]: number } = {
      janeiro: 0,
      fevereiro: 1,
      março: 2,
      abril: 3,
      maio: 4,
      junho: 5,
      julho: 6,
      agosto: 7,
      setembro: 8,
      outubro: 9,
      novembro: 10,
      dezembro: 11,
    };

    // Regex para capturar: "5 de novembro de 2025"
    const regex = /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i;
    const match = dateString.match(regex);

    if (!match) return null;

    const day = parseInt(match[1]);
    const month = months[match[2].toLowerCase()];
    const year = parseInt(match[3]);

    if (month === undefined) return null;

    return new Date(year, month, day);
  } catch (error) {
    console.error('Error parsing date:', dateString, error);
    return null;
  }
}

/**
 * Extrai horário do formato "20h30" ou "20h"
 */
export function parseTime(timeString: string): string | null {
  try {
    const regex = /(\d{1,2})h(\d{2})?/;
    const match = timeString.match(regex);

    if (!match) return null;

    const hours = match[1].padStart(2, '0');
    const minutes = match[2] ? match[2] : '00';

    return `${hours}:${minutes}`;
  } catch (error) {
    console.error('Error parsing time:', timeString, error);
    return null;
  }
}

/**
 * Normaliza texto removendo acentos e caracteres especiais
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Cria slug a partir de texto
 */
export function createSlug(text: string): string {
  return normalizeText(text)
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 100);
}

/**
 * Extrai data e horário de strings combinadas
 */
export function extractDateTime(text: string): {
  date: Date | null;
  time: string | null;
} {
  const date = parseDatePortuguese(text);
  const time = parseTime(text);

  return { date, time };
}
