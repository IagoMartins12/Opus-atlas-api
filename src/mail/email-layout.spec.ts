import { renderEmail, type EmailSpec } from './email-layout';

const spec: EmailSpec = {
  subject: 'Pagamento confirmado: o plano Mentor está ativo',
  preheader: 'O portal do professor já está aberto para você.',
  title: 'Tudo certo com o seu pagamento',
  paragraphs: ['Olá, <b>Ana</b>. O plano **Mentor** está ativo.'],
  emblem: 'recibo',
  action: { label: 'Abrir o portal', url: 'https://opusatlas.com.br/teacher' },
  highlight: { value: 'R$ 39,90', label: 'Mentor · mensal' },
  details: [{ label: 'Plano', value: 'Mentor' }],
  footer: 'cobranca',
};

describe('renderEmail', () => {
  const { html, text, subject } = renderEmail(
    spec,
    'https://opusatlas.com.br/',
    new Date('2026-10-11T15:00:00Z'),
  );

  it('monta o HTML da carta com canhoto, com imagens pelo endereço do site', () => {
    expect(subject).toBe(spec.subject);
    expect(html).toContain('https://opusatlas.com.br/email/selo.png');
    expect(html).toContain('https://opusatlas.com.br/email/emblema-recibo.png');
    expect(html).toContain('São Paulo, 11 de outubro de 2026');
    expect(html).toContain('R$ 39,90');
    expect(html).toContain('prefers-color-scheme: dark');
  });

  it('escapa o que vem de fora e só deixa o negrito marcado', () => {
    expect(html).not.toContain('<b>Ana</b>');
    expect(html).toContain('&lt;b&gt;Ana&lt;/b&gt;');
    expect(html).toContain('<strong>Mentor</strong>');
  });

  it('a versão em texto tem o mesmo conteúdo, com o link por extenso', () => {
    expect(text).toContain('Tudo certo com o seu pagamento');
    expect(text).toContain('Abrir o portal: https://opusatlas.com.br/teacher');
    expect(text).toContain('R$ 39,90 (Mentor · mensal)');
    expect(text).not.toContain('**');
    expect(text).toContain('Equipe Opus Atlas');
  });

  it('sem canhoto quando não há o que guardar', () => {
    const curto = renderEmail(
      { ...spec, highlight: undefined, details: undefined },
      'https://x',
    );
    expect(curto.html).not.toContain('dashed');
  });

  it('aviso interno sai sem assinatura', () => {
    const interno = renderEmail({ ...spec, signed: false }, 'https://x');
    expect(interno.html).not.toContain('Com carinho');
    expect(interno.text).not.toContain('Com carinho');
  });
});
