import { escapeHtml } from '../../common/utils/html.util';

/**
 * Resolução e personalização do conteúdo de uma campanha.
 *
 * Isolado como função pura porque **é aqui que o legado errava**, e errava em
 * silêncio: nenhuma das três falhas abaixo aparecia em log, só na caixa de
 * entrada de quem recebeu.
 */

/** Variáveis que a plataforma sabe preencher. A lista é fechada. */
export interface CampaignVariables {
  firstName: string;
  lastName: string;
  email: string;
  unsubscribeUrl: string;
  siteUrl: string;
  campaignName: string;
  year: string;
}

export const KNOWN_VARIABLES: readonly (keyof CampaignVariables)[] = [
  'firstName',
  'lastName',
  'email',
  'unsubscribeUrl',
  'siteUrl',
  'campaignName',
  'year',
];

export interface CampaignContent {
  subject: string;
  html: string;
  text: string;
  /** De onde o corpo veio — vai no resultado do job, para conferência. */
  source: 'custom' | 'template';
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Escolhe o corpo que vai ser enviado.
 *
 * **O legado nunca chegava aqui.** A rota de disparo chamava o envio passando
 * apenas o *tipo* do template (`campaign.template.type`), e o remetente então
 * procurava esse tipo num dicionário de templates **escritos em arquivo**.
 * Duas consequências, as duas invisíveis para o administrador:
 *
 * 1. O HTML que ele escreveu no painel — seja `customHtmlContent` da campanha,
 *    seja `htmlContent` do template salvo no banco — **era ignorado**. Os
 *    assinantes recebiam a versão de arquivo, não a que estava na tela.
 * 2. Campanha sem template caía em `type: 'DEFAULT'`, que não existe no
 *    dicionário. O envio devolvia "Template 'DEFAULT' não encontrado" para
 *    **cada destinatário**, a campanha virava `FAILED` e o campo `notes`
 *    recebia um JSON com uma linha de erro por assinante.
 *
 * Aqui a ordem é a que o painel mostra: conteúdo próprio ganha do template, e
 * template do banco é o template do banco.
 */
export function resolveContent(campaign: {
  subject: string;
  customSubject: string | null;
  customHtmlContent: string | null;
  customTextContent: string | null;
  template: { htmlContent: string; textContent: string } | null;
}): CampaignContent {
  const subject = campaign.customSubject?.trim() || campaign.subject;

  if (campaign.customHtmlContent) {
    return {
      subject,
      html: campaign.customHtmlContent,
      text:
        campaign.customTextContent ?? htmlToText(campaign.customHtmlContent),
      source: 'custom',
    };
  }

  if (campaign.template) {
    return {
      subject,
      html: campaign.template.htmlContent,
      text:
        campaign.template.textContent ||
        htmlToText(campaign.template.htmlContent),
      source: 'template',
    };
  }

  throw new Error(
    'Campanha sem template e sem conteúdo próprio não tem o que enviar',
  );
}

/**
 * Substitui as variáveis conhecidas.
 *
 * Dois cuidados que o legado não tinha:
 *
 * - **O valor é escapado no HTML.** `firstName` vem do formulário público de
 *   inscrição; um nome com `<` quebra a marcação do e-mail de todo mundo que
 *   se chame assim. Na versão em texto não há o que escapar.
 * - **Variável desconhecida vira vazio, e é reportada.** Deixar `{{newWorks}}`
 *   visível no e-mail é pior do que um espaço em branco, mas apagar em
 *   silêncio esconde o erro de quem escreveu o template — daí a lista voltar
 *   junto, para aparecer no resultado do job.
 */
export function render(
  source: string,
  variables: CampaignVariables,
  mode: 'html' | 'text' = 'html',
): string {
  return source.replace(PLACEHOLDER, (_match, name: string) => {
    const value = variables[name as keyof CampaignVariables];

    if (value === undefined) {
      return '';
    }

    return mode === 'html' ? escapeHtml(value) : value;
  });
}

/** Variáveis citadas no conteúdo que a plataforma não sabe preencher. */
export function unknownVariables(
  sources: string[],
  known: readonly string[] = KNOWN_VARIABLES,
): string[] {
  const found = new Set<string>();

  for (const source of sources) {
    for (const match of source.matchAll(PLACEHOLDER)) {
      if (!known.includes(match[1])) {
        found.add(match[1]);
      }
    }
  }

  return [...found].sort();
}

/**
 * Garante o link de descadastro no corpo do e-mail.
 *
 * **No legado, esse link nunca funcionou.** A rota montava
 * `unsubscribe?token=${sub.unsubscribeToken}` lendo a coluna
 * `NewsletterSubscriber.unsubscribeToken` — que **nenhum ponto do código
 * escreve**. Os fluxos de inscrição, confirmação e reinscrição criam um token
 * de descadastro, mas guardam em `UserToken` e usam só na hora do e-mail; a
 * coluna do assinante fica nula para sempre. Ou seja: toda campanha saía com
 * `token=null`, e ninguém conseguia sair da lista pelo link.
 *
 * Por isso o rodapé é acrescentado quando o conteúdo não cita o endereço: sair
 * da lista não pode depender de o autor do template ter lembrado.
 */
export function ensureUnsubscribe(
  html: string,
  text: string,
  unsubscribeUrl: string,
): { html: string; text: string } {
  const alreadyThere = html.includes(unsubscribeUrl);

  if (alreadyThere) {
    return { html, text };
  }

  const footerHtml = `
      <div style="margin-top:32px; padding-top:16px; border-top:1px solid rgba(212,175,55,0.3); text-align:center; color:#777; font-size:12px; font-family:Arial, Helvetica, sans-serif;">
        <a href="${unsubscribeUrl}" style="color:#777;">Cancelar inscrição na newsletter</a>
      </div>`;

  return {
    html: `${html}${footerHtml}`,
    text: `${text}\n\nCancelar inscrição: ${unsubscribeUrl}`,
  };
}

function htmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
