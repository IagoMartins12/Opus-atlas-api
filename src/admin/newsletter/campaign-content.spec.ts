import {
  CampaignVariables,
  ensureUnsubscribe,
  render,
  resolveContent,
  unknownVariables,
} from './campaign-content';

const variables: CampaignVariables = {
  firstName: 'Ana',
  lastName: 'Souza',
  email: 'ana@exemplo.com',
  unsubscribeUrl: 'https://opusatlas.com/newsletter/unsubscribe/abc',
  siteUrl: 'https://opusatlas.com',
  campaignName: 'Digest de setembro',
  year: '2026',
};

const campaign = (overrides: Record<string, unknown> = {}) => ({
  subject: 'Assunto da campanha',
  customSubject: null,
  customHtmlContent: null,
  customTextContent: null,
  template: null,
  ...overrides,
});

describe('resolveContent', () => {
  // O legado mandava só o *tipo* do template para o remetente, que então
  // buscava um template escrito em arquivo — o HTML do painel era ignorado.
  it('prefere o conteúdo próprio da campanha', () => {
    const content = resolveContent(
      campaign({
        customHtmlContent: '<p>Próprio</p>',
        customTextContent: 'Próprio',
        template: { htmlContent: '<p>Template</p>', textContent: 'Template' },
      }),
    );

    expect(content.html).toBe('<p>Próprio</p>');
    expect(content.source).toBe('custom');
  });

  it('usa o template salvo no banco quando não há conteúdo próprio', () => {
    const content = resolveContent(
      campaign({
        template: { htmlContent: '<p>Do banco</p>', textContent: 'Do banco' },
      }),
    );

    expect(content.html).toBe('<p>Do banco</p>');
    expect(content.source).toBe('template');
  });

  it('deriva a versão em texto quando ela falta', () => {
    const content = resolveContent(
      campaign({ customHtmlContent: '<p>Olá  <b>mundo</b></p>' }),
    );

    expect(content.text).toBe('Olá mundo');
  });

  it('assunto próprio ganha do assunto da campanha', () => {
    const content = resolveContent(
      campaign({ customSubject: 'Outro', customHtmlContent: '<p>Corpo</p>' }),
    );

    expect(content.subject).toBe('Outro');
  });

  it('assunto próprio em branco não apaga o assunto da campanha', () => {
    const content = resolveContent(
      campaign({ customSubject: '   ', customHtmlContent: '<p>Corpo</p>' }),
    );

    expect(content.subject).toBe('Assunto da campanha');
  });

  // No legado isso virava `type: 'DEFAULT'`, que não existia no dicionário de
  // templates: cada destinatário falhava e a campanha inteira ia para FAILED.
  it('recusa campanha sem template e sem conteúdo próprio', () => {
    expect(() => resolveContent(campaign())).toThrow(/não tem o que enviar/);
  });
});

describe('render', () => {
  it('substitui as variáveis conhecidas', () => {
    expect(render('Olá, {{firstName}}!', variables)).toBe('Olá, Ana!');
  });

  it('aceita espaço dentro das chaves', () => {
    expect(render('{{ firstName }}', variables)).toBe('Ana');
  });

  // `firstName` vem do formulário público de inscrição.
  it('escapa o valor no HTML', () => {
    const output = render('<p>{{firstName}}</p>', {
      ...variables,
      firstName: '<script>alerta</script>',
    });

    expect(output).toBe('<p>&lt;script&gt;alerta&lt;/script&gt;</p>');
  });

  it('não escapa na versão em texto', () => {
    const output = render(
      '{{firstName}}',
      { ...variables, firstName: 'A & B' },
      'text',
    );

    expect(output).toBe('A & B');
  });

  // Deixar `{{newWorks}}` visível no e-mail é pior do que um espaço vazio.
  it('apaga variável desconhecida', () => {
    expect(render('Novas obras: {{newWorks}}.', variables)).toBe(
      'Novas obras: .',
    );
  });
});

describe('unknownVariables', () => {
  it('lista o que a plataforma não sabe preencher', () => {
    expect(
      unknownVariables(['{{firstName}} {{newWorks}} {{activeUsers}}']),
    ).toEqual(['activeUsers', 'newWorks']);
  });

  it('não repete a mesma variável citada duas vezes', () => {
    expect(unknownVariables(['{{newWorks}}', '{{newWorks}}'])).toEqual([
      'newWorks',
    ]);
  });

  it('devolve lista vazia quando tudo é conhecido', () => {
    expect(unknownVariables(['{{firstName}} {{unsubscribeUrl}}'])).toEqual([]);
  });
});

describe('ensureUnsubscribe', () => {
  // No legado o link saía como `token=null`: a coluna que ele lia nunca era
  // escrita por lugar nenhum do código.
  it('acrescenta o rodapé quando o corpo não cita o endereço', () => {
    const result = ensureUnsubscribe(
      '<p>Corpo</p>',
      'Corpo',
      variables.unsubscribeUrl,
    );

    expect(result.html).toContain(variables.unsubscribeUrl);
    expect(result.text).toContain(variables.unsubscribeUrl);
  });

  it('não duplica quando o template já traz o link', () => {
    const html = `<a href="${variables.unsubscribeUrl}">sair</a>`;

    const result = ensureUnsubscribe(html, 'sair', variables.unsubscribeUrl);

    expect(result.html).toBe(html);
  });
});
