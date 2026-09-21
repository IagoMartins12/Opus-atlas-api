import { analyzeTemplate, TemplateInput } from './template-analysis';

const template = (over: Partial<TemplateInput> = {}): TemplateInput => ({
  subject: 'Cinco obras novas no catálogo desta semana',
  htmlContent:
    '<p>Olá {{firstName}}</p><a href="{{unsubscribeUrl}}">Descadastrar</a>',
  textContent: 'Olá {{firstName}}. Para descadastrar, acesse o link.',
  variables: ['firstName', 'unsubscribeUrl'],
  ...over,
});

describe('analyzeTemplate', () => {
  it('template completo não tem apontamento bloqueante', () => {
    const result = analyzeTemplate(template());

    expect(result.findings.filter((f) => f.severity === 'blocker')).toEqual([]);
    expect(result.score).toBeGreaterThan(80);
  });

  // Envio em massa sem saída é problema legal, não questão de estilo.
  it('sem link de descadastro é bloqueante', () => {
    const result = analyzeTemplate(
      template({
        htmlContent: '<p>Olá {{firstName}}</p>',
        textContent: 'Olá {{firstName}}',
      }),
    );

    const finding = result.findings.find(
      (f) => f.code === 'missingUnsubscribe',
    );

    expect(finding?.severity).toBe('blocker');
  });

  it('reconhece o descadastro em português', () => {
    const result = analyzeTemplate(
      template({
        htmlContent: '<p>oi</p><a href="#">Cancelar inscrição</a>',
      }),
    );

    expect(result.metrics.hasUnsubscribeLink).toBe(true);
  });

  it('sem versão em texto é bloqueante', () => {
    const result = analyzeTemplate(template({ textContent: '   ' }));

    expect(
      result.findings.find((f) => f.code === 'missingText')?.severity,
    ).toBe('blocker');
  });

  // Variável usada e não declarada chega ao destinatário como texto cru.
  it('acusa variável usada sem declarar', () => {
    const result = analyzeTemplate(
      template({
        htmlContent: '<p>Olá {{firstName}}, {{cidade}}</p><a>descadastrar</a>',
        variables: ['firstName'],
      }),
    );

    expect(result.metrics.undeclaredVariables).toEqual(['cidade']);
    expect(result.findings.some((f) => f.code === 'undeclaredVariables')).toBe(
      true,
    );
  });

  it('acusa variável declarada e nunca usada', () => {
    const result = analyzeTemplate(
      template({ variables: ['firstName', 'unsubscribeUrl', 'sobrenome'] }),
    );

    expect(result.metrics.unusedVariables).toEqual(['sobrenome']);
  });

  it('aceita variável com espaços dentro das chaves', () => {
    const result = analyzeTemplate(
      template({ htmlContent: '<p>{{ firstName }}</p><a>descadastrar</a>' }),
    );

    expect(result.metrics.usedVariables).toContain('firstName');
  });

  it('conta imagem sem texto alternativo', () => {
    const result = analyzeTemplate(
      template({
        htmlContent:
          '<img src="a.png"><img src="b.png" alt="capa"><a>descadastrar</a>',
      }),
    );

    expect(result.metrics.images).toBe(2);
    expect(result.metrics.imagesWithoutAlt).toBe(1);
  });

  it('assunto longo demais vira aviso com a medida', () => {
    const longo = 'a'.repeat(80);
    const result = analyzeTemplate(template({ subject: longo }));

    const finding = result.findings.find((f) => f.code === 'subjectTooLong');

    expect(finding?.severity).toBe('warning');
    expect(finding?.measured).toBe(80);
  });

  it('assunto curto demais é só informativo', () => {
    const result = analyzeTemplate(template({ subject: 'Oi' }));

    expect(
      result.findings.find((f) => f.code === 'subjectTooShort')?.severity,
    ).toBe('info');
  });

  it('conta palavras ignorando a marcação', () => {
    const result = analyzeTemplate(
      template({
        htmlContent: '<p><b>uma</b> duas três</p><a>descadastrar</a>',
      }),
    );

    expect(result.metrics.htmlWords).toBe(4);
  });

  // Soma dos pesos: descadastro 30, texto 25, variável não declarada 15,
  // imagem sem alt 10, variável não usada 5, assunto curto 5 = 90.
  it('a nota desconta cada apontamento pelo peso dele', () => {
    const result = analyzeTemplate({
      subject: 'x',
      htmlContent: '<img src="a.png">{{naoDeclarada}}',
      textContent: '',
      variables: ['naoUsada'],
    });

    expect(result.findings).toHaveLength(6);
    expect(result.score).toBe(10);
  });

  // A soma máxima possível dos pesos é 95, então a nota não chega a zero com
  // a tabela atual. O piso existe para não virar negativo se algum peso subir.
  it('a nota nunca fica negativa', () => {
    const result = analyzeTemplate({
      subject: 'a'.repeat(80),
      htmlContent: '<img src="a.png">{{naoDeclarada}}',
      textContent: '',
      variables: ['naoUsada'],
    });

    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});
