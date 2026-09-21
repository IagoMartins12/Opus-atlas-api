import { CategoryMember } from './imslp-api.client';

export interface DiscoveredWork {
  title: string;
  /** Id numérico da página no IMSLP — o mesmo que o catálogo guarda. */
  imslpId: string;
  imslpUrl: string;
}

/** Páginas do IMSLP que não são obra. */
const NOT_A_WORK = [
  /^category:/i,
  /^special:/i,
  /^help:/i,
  /^template:/i,
  /^user:/i,
  /\bcollection\b/i,
  /\bcategory\b/i,
  /\bdedicatee\b/i,
];

const MIN_TITLE = 2;
const MAX_TITLE = 200;

/**
 * Limpa e valida o título de uma obra vinda da categoria do compositor.
 *
 * Devolve `null` para o que não é obra. A categoria do IMSLP mistura obras com
 * páginas de ajuda, de dedicatária e de coletânea, e sem esse filtro elas
 * entrariam no catálogo como se fossem música.
 */
export function cleanDiscoveredTitle(title: string): string | null {
  if (!title) {
    return null;
  }

  const cleaned = title
    .trim()
    .replace(/\s+/g, ' ')
    // O IMSLP repete o compositor entre parênteses no fim do título.
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

  if (cleaned.length < MIN_TITLE || cleaned.length > MAX_TITLE) {
    return null;
  }

  return NOT_A_WORK.some((pattern) => pattern.test(cleaned)) ? null : cleaned;
}

/** O endereço da página, a partir do título que a API devolve. */
export function workUrlFromTitle(title: string): string {
  return new URL(
    `/wiki/${title.replace(/ /g, '_')}`,
    'https://imslp.org',
  ).toString();
}

/**
 * Converte os membros da categoria em obras candidatas à importação.
 *
 * **Não visita nenhuma delas.** A descoberta responde "o que existe lá"; ler
 * cada página é trabalho da importação, que acontece obra a obra e sob decisão
 * de quem conduz.
 */
export function discoveredWorksFrom(
  members: CategoryMember[],
): DiscoveredWork[] {
  const works = new Map<string, DiscoveredWork>();

  for (const member of members) {
    const title = cleanDiscoveredTitle(member.title);

    if (!title) {
      continue;
    }

    // A chave é o id numérico: é ele que casa com o catálogo, e é ele que
    // impede a mesma página de entrar duas vezes.
    works.set(String(member.pageid), {
      title,
      imslpId: String(member.pageid),
      imslpUrl: workUrlFromTitle(member.title),
    });
  }

  return [...works.values()];
}
