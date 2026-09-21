/**
 * Contrato de um insight administrativo.
 *
 * O legado devolvia números soltos e vereditos sem base — inclusive uma
 * `confidence` sorteada com `Math.min(85 + Math.random() * 10, 95)`, ou seja, a
 * própria medida de quanto confiar no número era inventada. Havia 35 chamadas a
 * `Math.random()` no arquivo de insights.
 *
 * O formato abaixo torna isso impossível por construção. Todo insight carrega:
 *
 * - **o que foi medido** (`measurement.value` e a unidade);
 * - **sobre quantos** (`measurement.sampleSize`);
 * - **o mínimo para a leitura valer** (`minimumSample`);
 * - **o que fazer** (`action`), quando há ação óbvia;
 * - **os casos concretos** (`evidence`), para o administrador conferir em vez
 *   de acreditar.
 *
 * Quando a amostra não alcança o mínimo, `buildInsight` rebaixa a severidade
 * para `insufficient_data` e zera o veredito. Não é disciplina de quem escreve:
 * é o construtor que impede a afirmação sem base.
 */

export type InsightSeverity =
  | 'critical'
  | 'warning'
  | 'opportunity'
  | 'healthy'
  | 'insufficient_data';

export type InsightUnit = 'count' | 'percent' | 'days' | 'ratio';

export interface InsightMeasurement {
  value: number | null;
  unit: InsightUnit;
  /** Quantos registros sustentam o valor. */
  sampleSize: number;
}

export interface Insight {
  /** Identificador estável, para a interface reagir sem depender do texto. */
  code: string;
  severity: InsightSeverity;
  title: string;
  detail: string;
  measurement: InsightMeasurement;
  minimumSample: number;
  action: string | null;
  /** Casos concretos por trás do número. Sempre limitado. */
  evidence: unknown[];
}

export interface BuildInsightInput {
  code: string;
  title: string;
  /** Severidade pretendida, aplicada só se a amostra bastar. */
  severity: Exclude<InsightSeverity, 'insufficient_data'>;
  detail: string;
  value: number | null;
  unit: InsightUnit;
  sampleSize: number;
  minimumSample?: number;
  action?: string;
  evidence?: unknown[];
}

/** Teto de exemplos por insight, para a resposta não crescer sem limite. */
const MAX_EVIDENCE = 20;

/**
 * Amostra mínima padrão.
 *
 * Cinco é o mesmo piso usado na comparação com colegas dos relatórios de
 * progresso: abaixo disso, uma "taxa" descreve indivíduos, não um padrão.
 */
const DEFAULT_MINIMUM_SAMPLE = 5;

export function buildInsight(input: BuildInsightInput): Insight {
  const minimumSample = input.minimumSample ?? DEFAULT_MINIMUM_SAMPLE;
  const hasBase = input.sampleSize >= minimumSample;

  return {
    code: input.code,
    severity: hasBase ? input.severity : 'insufficient_data',
    title: input.title,
    detail: hasBase
      ? input.detail
      : `Amostra insuficiente: ${input.sampleSize} registro(s), mínimo de ${minimumSample}.`,
    measurement: {
      value: hasBase ? input.value : null,
      unit: input.unit,
      sampleSize: input.sampleSize,
    },
    minimumSample,
    action: hasBase ? (input.action ?? null) : null,
    evidence: (input.evidence ?? []).slice(0, MAX_EVIDENCE),
  };
}

/** Percentual arredondado a uma casa, ou `null` sem denominador. */
export function percent(part: number, total: number): number | null {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : null;
}

/**
 * Ordena os insights pelo que exige atenção primeiro.
 *
 * `insufficient_data` vai para o fim: é informação sobre o que ainda não dá
 * para saber, não sobre o produto.
 */
const SEVERITY_ORDER: Record<InsightSeverity, number> = {
  critical: 0,
  warning: 1,
  opportunity: 2,
  healthy: 3,
  insufficient_data: 4,
};

export function sortInsights(insights: Insight[]): Insight[] {
  return [...insights].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}

/** Resumo por severidade, para a tela abrir no que importa. */
export function summarize(insights: Insight[]) {
  const counts: Record<InsightSeverity, number> = {
    critical: 0,
    warning: 0,
    opportunity: 0,
    healthy: 0,
    insufficient_data: 0,
  };

  for (const insight of insights) {
    counts[insight.severity] += 1;
  }

  return {
    total: insights.length,
    bySeverity: counts,
    needsAttention: counts.critical + counts.warning,
  };
}
