import Anthropic from '@anthropic-ai/sdk';
import type { AiCompletionRequest, AiProvider, FetchFn } from './ai-providers';
import { AiProviderError } from './ai-providers';

export type AnthropicEffort = 'low' | 'medium' | 'high';

/** Só a parte do SDK que o provedor usa — é o que os testes substituem. */
type MessagesClient = Pick<Anthropic, 'beta'>;

/**
 * Claude pelo SDK oficial.
 *
 * Três cuidados que o formato cru não mostrava:
 *
 * - **O Opus 5 pensa por padrão**, e o pensamento consome do mesmo
 *   `max_tokens`. O esforço (`ANTHROPIC_EFFORT`, padrão `medium`) regula o
 *   quanto; biografia não pede raciocínio longo.
 * - **Resposta cortada não é resposta.** `stop_reason: max_tokens` deixava uma
 *   biografia pela metade gravada como pronta; aqui vira falha, e a cascata
 *   passa para o próximo provedor.
 * - **Recusa tem desvio no próprio servidor** (`fallbacks: "default"`): se o
 *   filtro de segurança do modelo recusar, a Anthropic refaz o pedido noutro
 *   modelo dela antes de devolver. Recusa que sobra vira falha, como a cortada.
 *
 * Uma nova tentativa só: numa cascata, insistir no mesmo provedor atrasa o
 * próximo.
 */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic' as const;
  private readonly client: MessagesClient;

  constructor(
    apiKey: string,
    readonly model: string,
    private readonly effort: AnthropicEffort = 'medium',
    options: { fetch?: FetchFn; client?: MessagesClient } = {},
  ) {
    this.client =
      options.client ??
      new Anthropic({ apiKey, maxRetries: 1, fetch: options.fetch });
  }

  async complete(
    request: AiCompletionRequest,
    signal: AbortSignal,
  ): Promise<string> {
    let response: Anthropic.Beta.BetaMessage;

    try {
      response = await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: [{ role: 'user', content: request.prompt }],
          output_config: { effort: this.effort },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        },
        { signal },
      );
    } catch (error: unknown) {
      if (error instanceof Anthropic.APIError) {
        throw new AiProviderError(
          this.name,
          error.status ?? null,
          `HTTP ${error.status ?? '?'} — ${error.message.slice(0, 200)}`,
        );
      }
      throw error;
    }

    if (response.stop_reason === 'max_tokens') {
      throw new AiProviderError(
        this.name,
        null,
        'resposta cortada no limite de tokens',
      );
    }

    if (response.stop_reason === 'refusal') {
      throw new AiProviderError(
        this.name,
        null,
        `recusou (${response.stop_details?.category ?? 'sem categoria'})`,
      );
    }

    return response.content
      .filter(
        (block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text',
      )
      .map((block) => block.text)
      .join('');
  }
}
