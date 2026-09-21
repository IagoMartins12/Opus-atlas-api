import { buildInsight, percent, sortInsights, summarize } from './insight';

describe('contrato de insight', () => {
  const base = {
    code: 'teste',
    title: 'Título',
    severity: 'critical' as const,
    detail: 'Detalhe com o número.',
    value: 42,
    unit: 'percent' as const,
  };

  // É o construtor que impede a afirmação sem base, não a disciplina de quem
  // escreve o insight.
  it('sem amostra suficiente, rebaixa a severidade e zera o veredito', () => {
    const insight = buildInsight({
      ...base,
      sampleSize: 2,
      minimumSample: 10,
      action: 'Fazer alguma coisa',
    });

    expect(insight.severity).toBe('insufficient_data');
    expect(insight.measurement.value).toBeNull();
    expect(insight.action).toBeNull();
    expect(insight.detail).toContain('Amostra insuficiente');
  });

  it('a amostra é sempre reportada, mesmo quando insuficiente', () => {
    const insight = buildInsight({ ...base, sampleSize: 2, minimumSample: 10 });

    expect(insight.measurement.sampleSize).toBe(2);
    expect(insight.minimumSample).toBe(10);
  });

  it('com base, mantém severidade, valor e ação', () => {
    const insight = buildInsight({
      ...base,
      sampleSize: 50,
      minimumSample: 10,
      action: 'Fazer alguma coisa',
    });

    expect(insight.severity).toBe('critical');
    expect(insight.measurement.value).toBe(42);
    expect(insight.action).toBe('Fazer alguma coisa');
  });

  it('a amostra mínima padrão é cinco', () => {
    expect(buildInsight({ ...base, sampleSize: 4 }).severity).toBe(
      'insufficient_data',
    );
    expect(buildInsight({ ...base, sampleSize: 5 }).severity).toBe('critical');
  });

  // A resposta não pode crescer sem limite com o tamanho da base.
  it('limita a evidência a vinte itens', () => {
    const insight = buildInsight({
      ...base,
      sampleSize: 100,
      evidence: Array.from({ length: 200 }, (_, i) => i),
    });

    expect(insight.evidence).toHaveLength(20);
  });

  it('sem evidência, devolve lista vazia e não indefinido', () => {
    expect(buildInsight({ ...base, sampleSize: 100 }).evidence).toEqual([]);
  });
});

describe('percent', () => {
  // Denominador zero não é 0%, é ausência de medida.
  it('sem denominador, devolve nulo', () => {
    expect(percent(0, 0)).toBeNull();
    expect(percent(5, 0)).toBeNull();
  });

  it('arredonda a uma casa', () => {
    expect(percent(1, 3)).toBe(33.3);
  });
});

describe('ordenação e resumo', () => {
  const insight = (severity: 'critical' | 'warning' | 'healthy', n = 100) =>
    buildInsight({
      code: severity,
      title: severity,
      severity,
      detail: '',
      value: 1,
      unit: 'count',
      sampleSize: n,
    });

  it('o que exige atenção vem primeiro', () => {
    const ordenado = sortInsights([
      insight('healthy'),
      insight('critical'),
      insight('warning'),
    ]);

    expect(ordenado.map((i) => i.severity)).toEqual([
      'critical',
      'warning',
      'healthy',
    ]);
  });

  // É informação sobre o que ainda não dá para saber, não sobre o produto.
  it('o que não tem base vai para o fim', () => {
    const semBase = buildInsight({
      code: 'x',
      title: 'x',
      severity: 'critical',
      detail: '',
      value: 1,
      unit: 'count',
      sampleSize: 1,
    });

    const ordenado = sortInsights([semBase, insight('healthy')]);

    expect(ordenado[ordenado.length - 1].severity).toBe('insufficient_data');
  });

  it('o resumo separa o que precisa de atenção', () => {
    const resumo = summarize([
      insight('critical'),
      insight('warning'),
      insight('healthy'),
    ]);

    expect(resumo.total).toBe(3);
    expect(resumo.needsAttention).toBe(2);
    expect(resumo.bySeverity.healthy).toBe(1);
  });
});
