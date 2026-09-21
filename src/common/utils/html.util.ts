const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Texto para dentro de HTML (conteúdo ou atributo entre aspas).
 *
 * Todo dado que o usuário escreve e vai parar num e-mail passa por aqui: nome,
 * assunto, mensagem. Sem isso, o nome `<a href="…">Clique aqui</a>` vira link
 * de verdade no e-mail — e alguns e-mails são disparados sem login, para
 * qualquer endereço (inscrição na newsletter), com a marca do Opus Atlas.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}
