import {
  BadRequestException,
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiTextService, AiUnavailableError } from '../../ai/ai-text.service';

export const TRANSLATION_LANGUAGES = ['pt', 'en'] as const;
export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];

/** O pedido tem de caber numa chamada só ao modelo. */
export const TRANSLATION_LIMITS = { texts: 600, chars: 60_000 } as const;

const NAMES: Record<TranslationLanguage, string> = {
  pt: 'Brazilian Portuguese',
  en: 'English',
};

/**
 * Tradução de textos do blog entre português e inglês — o botão "Traduzir"
 * da tela de escrita, da categoria e da tag.
 *
 * **Recebe textos soltos, não o artigo.** Quem chama (o front) separa do
 * JSON do editor os trechos de texto, manda em lista e remonta o documento
 * com a resposta: a estrutura (títulos, listas, blocos, links, negrito)
 * nunca passa pelo modelo, só as palavras. Assim a política de conteúdo do
 * artigo vale para a tradução sem nenhuma regra nova, e um modelo que
 * "melhora" o HTML não tem HTML para mexer.
 *
 * Nada é gravado aqui: a tradução volta para o formulário, quem escreve
 * revisa e salva.
 */
@Injectable()
export class BlogTranslationService {
  constructor(private readonly ai: AiTextService) {}

  async translate(
    texts: string[],
    from: TranslationLanguage,
    to: TranslationLanguage,
  ): Promise<string[]> {
    if (from === to) return texts;
    if (!this.ai.enabled) {
      throw new ServiceUnavailableException(
        'Tradução automática indisponível: nenhum provedor de IA configurado',
      );
    }

    const total = texts.reduce((sum, text) => sum + text.length, 0);
    if (total > TRANSLATION_LIMITS.chars) {
      throw new BadRequestException(
        `Texto longo demais para traduzir de uma vez (${total} de ${TRANSLATION_LIMITS.chars} caracteres)`,
      );
    }

    // Os vazios (e só espaços) voltam como vieram, sem gastar o modelo.
    const indexes = texts
      .map((text, i) => (text.trim() ? i : -1))
      .filter((i) => i >= 0);
    if (!indexes.length) return texts;

    let completion;
    try {
      completion = await this.ai.complete({
        system: [
          `You translate texts from a classical music blog from ${NAMES[from]} into ${NAMES[to]}.`,
          'You receive a JSON array of strings; answer with a JSON array of the same length, in the same order, each item the translation of the item at the same position.',
          'Items may be fragments of one sentence split by formatting: translate each so that, joined in order, they read naturally. Keep leading and trailing spaces of each item.',
          'Keep names of people, works, catalog numbers (BWV, K., Op.) and quotes in their original form when that is the usual practice. Do not add, remove or explain anything.',
          'Answer with the JSON array only.',
        ].join(' '),
        prompt: JSON.stringify(indexes.map((i) => texts[i])),
        maxTokens: Math.min(16_000, Math.ceil(total / 2) + 1_000),
      });
    } catch (error: unknown) {
      if (error instanceof AiUnavailableError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }

    const translated = parseArray(completion.text);
    if (!translated || translated.length !== indexes.length) {
      throw new BadGatewayException(
        'A tradução voltou num formato inesperado. Tente de novo.',
      );
    }

    const out = [...texts];
    indexes.forEach((original, i) => {
      out[original] = translated[i];
    });
    return out;
  }
}

/** O modelo às vezes cerca o JSON com ```; aceita e confere que é lista de textos. */
export function parseArray(raw: string): string[] | null {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(value) && value.every((v) => typeof v === 'string')
      ? value
      : null;
  } catch {
    return null;
  }
}
