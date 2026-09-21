/**
 * Análise estática de um template de e-mail.
 *
 * É função pura: recebe o template, devolve o diagnóstico. No legado a análise
 * vivia dentro da rota, misturada com a consulta e com a gravação do resultado,
 * o que a tornava impossível de testar sem banco.
 *
 * Cada apontamento diz **o que foi medido**, não só um veredito — um "score 62"
 * sozinho não ajuda ninguém a melhorar o template.
 */

/** Assunto muito longo é cortado na caixa de entrada da maioria dos clientes. */
const SUBJECT_MAX = 60;

/** Abaixo disto o assunto costuma ser vago demais para gerar abertura. */
const SUBJECT_MIN = 20;

/** Peso de cada apontamento no total. */
const PENALTY = {
  missingText: 25,
  missingUnsubscribe: 30,
  subjectTooLong: 10,
  subjectTooShort: 5,
  noPersonalization: 10,
  imagesWithoutAlt: 10,
  undeclaredVariables: 15,
  unusedVariables: 5,
} as const;

export interface TemplateInput {
  subject: string;
  htmlContent: string;
  textContent: string;
  variables: string[];
}

export type FindingSeverity = 'blocker' | 'warning' | 'info';

export interface TemplateFinding {
  code: keyof typeof PENALTY;
  severity: FindingSeverity;
  message: string;
  /** O valor medido que sustenta o apontamento. */
  measured: string | number;
}

export interface TemplateAnalysis {
  /** 0 a 100. Começa em 100 e desconta cada apontamento. */
  score: number;
  findings: TemplateFinding[];
  metrics: {
    subjectLength: number;
    htmlWords: number;
    textWords: number;
    images: number;
    imagesWithoutAlt: number;
    links: number;
    declaredVariables: number;
    usedVariables: string[];
    undeclaredVariables: string[];
    unusedVariables: string[];
    hasUnsubscribeLink: boolean;
  };
}

/** `{{ nomeDaVariavel }}` — com ou sem espaços. */
const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

const IMG_PATTERN = /<img\b[^>]*>/gi;

const stripTags = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const countWords = (text: string): number =>
  text.length === 0 ? 0 : text.split(/\s+/).length;

function usedVariables(template: TemplateInput): string[] {
  const found = new Set<string>();
  const haystack = `${template.subject} ${template.htmlContent} ${template.textContent}`;

  for (const match of haystack.matchAll(VARIABLE_PATTERN)) {
    found.add(match[1]);
  }

  return [...found].sort();
}

/**
 * Link de descadastro.
 *
 * Procura tanto a variável quanto a palavra, porque o template pode trazer o
 * link montado. É o único apontamento que bloqueia: e-mail em massa sem saída é
 * problema legal, não questão de estilo.
 */
function hasUnsubscribe(template: TemplateInput): boolean {
  const haystack =
    `${template.htmlContent} ${template.textContent}`.toLowerCase();

  return (
    haystack.includes('unsubscribe') ||
    haystack.includes('descadastr') ||
    haystack.includes('cancelar inscri')
  );
}

export function analyzeTemplate(template: TemplateInput): TemplateAnalysis {
  const images = template.htmlContent.match(IMG_PATTERN) ?? [];
  const imagesWithoutAlt = images.filter(
    (tag) => !/\balt\s*=/i.test(tag),
  ).length;

  const used = usedVariables(template);
  const declared = new Set(template.variables);

  const undeclared = used.filter((name) => !declared.has(name));
  const unused = template.variables.filter((name) => !used.includes(name));

  const metrics: TemplateAnalysis['metrics'] = {
    subjectLength: template.subject.length,
    htmlWords: countWords(stripTags(template.htmlContent)),
    textWords: countWords(template.textContent.trim()),
    images: images.length,
    imagesWithoutAlt,
    links: (template.htmlContent.match(/<a\b/gi) ?? []).length,
    declaredVariables: template.variables.length,
    usedVariables: used,
    undeclaredVariables: undeclared,
    unusedVariables: unused,
    hasUnsubscribeLink: hasUnsubscribe(template),
  };

  const findings: TemplateFinding[] = [];

  if (!metrics.hasUnsubscribeLink) {
    findings.push({
      code: 'missingUnsubscribe',
      severity: 'blocker',
      message:
        'Sem link de descadastro. Envio em massa sem saída é problema legal, não de estilo.',
      measured: 0,
    });
  }

  if (metrics.textWords === 0) {
    findings.push({
      code: 'missingText',
      severity: 'blocker',
      message:
        'Sem versão em texto. Provedores tratam e-mail só-HTML como sinal de spam.',
      measured: 0,
    });
  }

  if (metrics.subjectLength > SUBJECT_MAX) {
    findings.push({
      code: 'subjectTooLong',
      severity: 'warning',
      message: `Assunto com ${metrics.subjectLength} caracteres; acima de ${SUBJECT_MAX} costuma ser cortado na caixa de entrada.`,
      measured: metrics.subjectLength,
    });
  } else if (metrics.subjectLength < SUBJECT_MIN) {
    findings.push({
      code: 'subjectTooShort',
      severity: 'info',
      message: `Assunto com ${metrics.subjectLength} caracteres; abaixo de ${SUBJECT_MIN} tende a ser vago demais.`,
      measured: metrics.subjectLength,
    });
  }

  if (used.length === 0) {
    findings.push({
      code: 'noPersonalization',
      severity: 'info',
      message: 'Nenhuma variável usada — o e-mail é igual para todo mundo.',
      measured: 0,
    });
  }

  if (imagesWithoutAlt > 0) {
    findings.push({
      code: 'imagesWithoutAlt',
      severity: 'warning',
      message: `${imagesWithoutAlt} imagem(ns) sem texto alternativo — muitos clientes bloqueiam imagens por padrão.`,
      measured: imagesWithoutAlt,
    });
  }

  if (undeclared.length > 0) {
    findings.push({
      code: 'undeclaredVariables',
      severity: 'warning',
      message: `Variáveis usadas mas não declaradas: ${undeclared.join(', ')}. Elas chegam ao destinatário como texto cru.`,
      measured: undeclared.length,
    });
  }

  if (unused.length > 0) {
    findings.push({
      code: 'unusedVariables',
      severity: 'info',
      message: `Variáveis declaradas e não usadas: ${unused.join(', ')}.`,
      measured: unused.length,
    });
  }

  const score = findings.reduce(
    (total, finding) => total - PENALTY[finding.code],
    100,
  );

  return { score: Math.max(0, score), findings, metrics };
}
