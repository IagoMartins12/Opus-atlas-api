import { escapeHtml } from '../common/utils/html.util';

/**
 * The base layout of every Opus Atlas email: "the letter with a stub"
 * (direction D, chosen by the owner on 11/10). The team writes a letter on
 * cream paper inside a gold hairline frame, with an engraved emblem at its
 * head like a wax seal, and below a dashed tear line hands over the stub
 * with what is worth keeping: the figure in large Garamond (an amount, a
 * deadline, a result), the details, or the ways in.
 *
 * Built for hard clients: tables and inline styles, a bulletproof button,
 * images by absolute URL with `alt`, 600px wide. Light by default; Apple
 * Mail and iOS switch to dark through `prefers-color-scheme`, and phones
 * stack the columns through a media query. Every email also ships a plain
 * text version rendered from the same content.
 */

export type Emblema =
  | 'bussola'
  | 'envelope'
  | 'chave'
  | 'turma'
  | 'recibo'
  | 'balanca'
  | 'estrela'
  | 'lua';

export type FooterKind = 'conta' | 'seguranca' | 'cobranca' | 'newsletter';

export interface EmailLink {
  label: string;
  url: string;
}

export interface EmailSpec {
  subject: string;
  /** The line inboxes show beside the subject. */
  preheader: string;
  title: string;
  /** Plain text; `**bold**` becomes bold. Escaped by the renderer. */
  paragraphs: string[];
  emblem: Emblema;
  action?: EmailLink;
  /** A quiet second link under the button ("Recusar"). */
  secondary?: EmailLink;
  /** The figure worth seeing from afar, set large on the stub. */
  highlight?: { value: string; label: string };
  details?: { label: string; value: string }[];
  /** The welcome's ways in, as three columns on the stub. */
  paths?: (EmailLink & { title: string; text: string })[];
  footer: FooterKind;
  /** Replaces the footer's default sentence for this email. */
  footerText?: string;
  /** Unsubscribe link, for newsletter emails. */
  unsubscribe?: EmailLink;
  /** The team's signature; off for internal notices. */
  signed?: boolean;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const FOOTERS: Record<FooterKind, string> = {
  conta:
    'Você recebeu este e-mail porque tem uma conta no Opus Atlas. Escolha quais avisos chegam por e-mail em Meu perfil.',
  seguranca:
    'Não foi você? Ignore este e-mail: nada muda na sua conta sem o clique no botão.',
  cobranca:
    'Cobrança feita pelo Stripe, em reais. Para trocar de plano ou cancelar, use Meu perfil → Configurações da Conta. Em até 7 dias da assinatura você pode desistir e receber o valor de volta.',
  newsletter:
    'Você recebe esta newsletter porque se inscreveu no site do Opus Atlas.',
};

const ADDRESS = 'opusatlas.com.br · São Paulo, Brasil';

/** Palette: the site tokens, as hex (clients ignore CSS variables). */
const C = {
  fora: '#efe8da',
  papel: '#fbf8f2',
  papel2: '#f4ede0',
  texto: '#1c1b22',
  suave: '#5b5766',
  fraco: '#6b6678',
  ouroTexto: '#855f00',
  filete: 'rgba(187,134,10,0.45)',
  linha: '#e4dccb',
  botao: '#d4af37',
  botaoTexto: '#1c1b22',
};

const SERIF = "'EB Garamond', Georgia, 'Times New Roman', serif";
const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const STYLE = `
  body { margin:0; padding:0; background:${C.fora}; -webkit-text-size-adjust:100%; }
  table { border-collapse:collapse; }
  img { border:0; line-height:100%; outline:none; text-decoration:none; }
  a { color:${C.ouroTexto}; }
  @media (max-width: 620px) {
    .oa-outer { padding:24px 10px 0 !important; }
    .oa-card { padding:10px !important; }
    .oa-frame { padding:26px 20px !important; }
    .oa-stub { padding:22px 20px !important; }
    .oa-h1 { font-size:30px !important; }
    .oa-col { display:block !important; width:100% !important; padding:0 0 18px !important; }
    .oa-emblem { width:96px !important; height:96px !important; }
  }
  @media (prefers-color-scheme: dark) {
    body, .oa-bg { background:#0c0d12 !important; }
    .oa-paper { background:#191a24 !important; }
    .oa-paper2 { background:#21222e !important; }
    .oa-t { color:#f3f1ec !important; }
    .oa-s { color:#b5b1c0 !important; }
    .oa-f { color:#8f8b9c !important; }
    .oa-g { color:#e0bc5c !important; }
    .oa-rule { border-color:rgba(212,175,55,0.38) !important; }
    .oa-line { border-color:rgba(243,241,236,0.12) !important; }
  }
`;

/** Escape, then `**bold**` → <strong>. */
function inline(text: string): string {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

const plain = (text: string) => text.replace(/\*\*(.+?)\*\*/g, '$1');

function dateLine(now: Date): string {
  const date = new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  }).format(now);
  return `São Paulo, ${date}`;
}

function button(link: EmailLink): string {
  // A table cell with the color as `bgcolor` keeps the button in Outlook.
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:30px 0 0;">
  <tr>
    <td bgcolor="${C.botao}" style="border-radius:999px; background:${C.botao};">
      <a href="${escapeHtml(link.url)}" style="display:inline-block; padding:15px 30px; font-family:${SANS}; font-size:16px; font-weight:600; color:${C.botaoTexto}; text-decoration:none; border-radius:999px;">${escapeHtml(link.label)}</a>
    </td>
  </tr>
</table>`;
}

function stub(spec: EmailSpec): string {
  const rows: string[] = [];

  if (spec.highlight || spec.details) {
    const highlight = spec.highlight
      ? `<p class="oa-g" style="margin:0; font-family:${SERIF}; font-size:40px; line-height:1; color:${C.ouroTexto};">${escapeHtml(spec.highlight.value)}</p>
         <p class="oa-f" style="margin:8px 0 0; font-family:${SERIF}; font-style:italic; font-size:16px; color:${C.fraco};">${escapeHtml(spec.highlight.label)}</p>`
      : '';
    const details = spec.details
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${spec.details
          .map(
            (d) => `<tr>
              <td class="oa-f oa-line" style="padding:7px 0; border-bottom:1px solid ${C.linha}; font-family:${SANS}; font-size:14px; color:${C.fraco};">${escapeHtml(d.label)}</td>
              <td class="oa-t oa-line" align="right" style="padding:7px 0; border-bottom:1px solid ${C.linha}; font-family:${SANS}; font-size:14px; font-weight:600; color:${C.texto};">${escapeHtml(d.value)}</td>
            </tr>`,
          )
          .join('')}</table>`
      : '';
    rows.push(
      highlight && details
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
             <td class="oa-col" width="42%" valign="middle" style="padding-right:24px;">${highlight}</td>
             <td class="oa-col" width="58%" valign="middle">${details}</td>
           </tr></table>`
        : highlight || details,
    );
  }

  if (spec.paths) {
    rows.push(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${spec.paths
        .map(
          (
            p,
            i,
          ) => `<td class="oa-col" width="33%" valign="top" style="padding:0 ${i < 2 ? 18 : 0}px 0 0;">
            <p class="oa-t" style="margin:0; font-family:${SERIF}; font-size:20px; color:${C.texto};">${escapeHtml(p.title)}</p>
            <p class="oa-s" style="margin:6px 0 0; font-family:${SANS}; font-size:13.5px; line-height:1.55; color:${C.suave};">${escapeHtml(p.text)}</p>
            <a class="oa-g" href="${escapeHtml(p.url)}" style="display:inline-block; margin-top:8px; font-family:${SANS}; font-size:13.5px; font-weight:600; color:${C.ouroTexto};">${escapeHtml(p.label)}</a>
          </td>`,
        )
        .join('')}</tr></table>`,
    );
  }

  if (!rows.length) return '';

  return `
<table role="presentation" class="oa-paper2" width="600" cellpadding="0" cellspacing="0" style="width:100%; max-width:600px; background:${C.papel2}; border-radius:16px;">
  <tr><td class="oa-card" style="padding:14px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td class="oa-line" style="border-top:2px dashed ${C.linha}; font-size:0; line-height:0; height:14px;">&nbsp;</td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="oa-rule" style="border:1px solid ${C.filete}; border-radius:10px;">
      <tr><td class="oa-stub" style="padding:30px 46px;">${rows.join('<div style="height:22px;"></div>')}</td></tr>
    </table>
  </td></tr>
</table>`;
}

/** The HTML and the plain text of one email. */
export function renderEmail(
  spec: EmailSpec,
  assetsBaseUrl: string,
  now = new Date(),
): RenderedEmail {
  const base = assetsBaseUrl.replace(/\/$/, '');
  const footer = spec.footerText ?? FOOTERS[spec.footer];
  const signed = spec.signed ?? true;

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(spec.subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap" rel="stylesheet">
<style>${STYLE}</style>
</head>
<body class="oa-bg" style="margin:0; padding:0; background:${C.fora};">
<div style="display:none; max-height:0; overflow:hidden; opacity:0;">${escapeHtml(spec.preheader)}</div>
<table role="presentation" class="oa-bg" width="100%" cellpadding="0" cellspacing="0" style="background:${C.fora};">
<tr><td class="oa-outer" align="center" style="padding:48px 24px 0;">

<table role="presentation" class="oa-paper" width="600" cellpadding="0" cellspacing="0" style="width:100%; max-width:600px; background:${C.papel}; border-radius:16px;">
  <tr><td class="oa-card" style="padding:14px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="oa-rule" style="border:1px solid ${C.filete}; border-radius:10px;">
      <tr><td class="oa-frame" style="padding:44px 46px;">

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td valign="middle"><img src="${base}/email/selo.png" width="50" height="51" alt="Opus Atlas" style="display:block;"></td>
          <td valign="middle" align="right" class="oa-f" style="font-family:${SERIF}; font-style:italic; font-size:15px; color:${C.fraco};">${escapeHtml(dateLine(now))}</td>
        </tr></table>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td align="center" style="padding:26px 0 0;"><img class="oa-emblem" src="${base}/email/emblema-${spec.emblem}.png" width="116" height="116" alt="" style="display:block;"></td>
        </tr></table>

        <h1 class="oa-h1 oa-t" style="margin:24px 0 0; text-align:center; font-family:${SERIF}; font-weight:500; font-size:38px; line-height:1.08; color:${C.texto};">${escapeHtml(spec.title)}</h1>
        <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:22px auto 0;"><tr><td class="oa-rule" width="56" style="border-top:1px solid ${C.filete}; font-size:0; line-height:0;">&nbsp;</td></tr></table>

        ${spec.paragraphs
          .map(
            (p, i) =>
              `<p class="${i === 0 ? 'oa-t' : 'oa-s'}" style="margin:16px 0 0; font-family:${SERIF}; font-size:19px; line-height:1.55; color:${i === 0 ? C.texto : C.suave}; white-space:pre-line;">${inline(p)}</p>`,
          )
          .join('\n')}

        ${spec.action ? button(spec.action) : ''}
        ${
          spec.secondary
            ? `<p style="margin:14px 0 0; font-family:${SANS}; font-size:14px;"><a class="oa-f" href="${escapeHtml(spec.secondary.url)}" style="color:${C.fraco};">${escapeHtml(spec.secondary.label)}</a></p>`
            : ''
        }
        ${
          signed
            ? `<p class="oa-t" style="margin:30px 0 0; font-family:${SERIF}; font-size:18px; line-height:1.35; color:${C.texto};"><span class="oa-s" style="font-style:italic; color:${C.suave};">Com carinho,</span><br>Equipe Opus Atlas</p>`
            : ''
        }

      </td></tr>
    </table>
  </td></tr>
</table>

${stub(spec)}

<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%; max-width:500px;">
  <tr><td align="center" class="oa-f" style="padding:28px 24px 40px; font-family:${SANS}; font-size:12.5px; line-height:1.6; color:${C.fraco};">
    <p style="margin:0;">${inline(footer)}</p>
    ${spec.unsubscribe ? `<p style="margin:10px 0 0;"><a class="oa-f" href="${escapeHtml(spec.unsubscribe.url)}" style="color:${C.fraco};">${escapeHtml(spec.unsubscribe.label)}</a></p>` : ''}
    <p style="margin:10px 0 0;">${ADDRESS}</p>
  </td></tr>
</table>

</td></tr>
</table>
</body>
</html>`;

  const text = [
    spec.title,
    '',
    ...spec.paragraphs.map(plain),
    ...(spec.action ? ['', `${spec.action.label}: ${spec.action.url}`] : []),
    ...(spec.secondary
      ? [`${spec.secondary.label}: ${spec.secondary.url}`]
      : []),
    ...(spec.highlight
      ? ['', `${spec.highlight.value} (${spec.highlight.label})`]
      : []),
    ...(spec.details ?? []).map((d) => `${d.label}: ${d.value}`),
    ...(spec.paths ?? []).flatMap((p) => [
      '',
      `${p.title}. ${p.text}`,
      `${p.label}: ${p.url}`,
    ]),
    ...(signed ? ['', 'Com carinho,', 'Equipe Opus Atlas'] : []),
    '',
    '---',
    plain(footer),
    ...(spec.unsubscribe
      ? [`${spec.unsubscribe.label}: ${spec.unsubscribe.url}`]
      : []),
    ADDRESS,
  ].join('\n');

  return { subject: spec.subject, html, text };
}
