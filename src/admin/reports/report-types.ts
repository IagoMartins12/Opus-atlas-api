export const REPORT_TYPES = {
  'users-overview': 'Resumo de Usuários',
  'content-analysis': 'Análise de Conteúdo',
  'engagement-metrics': 'Métricas de Engajamento',
} as const;

export type ReportType = keyof typeof REPORT_TYPES;

export const REPORT_PERIODS = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
} as const;

export type ReportPeriod = keyof typeof REPORT_PERIODS;

/** Uma tabela do relatório — vira um bloco do CSV. */
export interface ReportSection {
  title: string;
  columns: string[];
  rows: Array<Array<string | number | null>>;
}

/**
 * O retrato do relatório, gravado em `GeneratedReport.reportData`. O CSV é
 * gerado dele a cada download — o número não muda depois de gerado, e não há
 * arquivo em disco para perder.
 */
export interface ReportData {
  summary: Array<[label: string, value: number]>;
  sections: ReportSection[];
}

export function periodRange(period: ReportPeriod, now = new Date()) {
  const days = REPORT_PERIODS[period];
  return {
    start: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
    end: now,
  };
}
