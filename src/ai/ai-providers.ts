import { AnthropicEffort, AnthropicProvider } from './anthropic.provider';

/**
 * Os provedores de texto por IA, cada um atrás da mesma interface.
 *
 * A Anthropic vai pelo SDK oficial (`anthropic.provider.ts`). OpenAI e Groq
 * falam o mesmo formato de chat e vão por um `POST` só, sem SDK. Acrescentar um
 * provedor é escrever uma classe e registrá-la em `PROVIDER_FACTORIES`.
 */

export const AI_PROVIDER_NAMES = ['anthropic', 'openai', 'groq'] as const;

export type AiProviderName = (typeof AI_PROVIDER_NAMES)[number];

export interface AiCompletionRequest {
  system: string;
  prompt: string;
  maxTokens: number;
}

export interface AiProvider {
  readonly name: AiProviderName;
  readonly model: string;
  complete(request: AiCompletionRequest, signal: AbortSignal): Promise<string>;
}

export interface AiProviderConfig {
  apiKey?: string;
  model: string;
  /** Só Anthropic: quanto o modelo pensa antes de escrever. */
  effort?: AnthropicEffort;
}

export type FetchFn = typeof fetch;

/** Falha de um provedor — a cascata registra e passa para o próximo. */
export class AiProviderError extends Error {
  constructor(
    readonly provider: AiProviderName,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

async function failureOf(
  provider: AiProviderName,
  response: Response,
): Promise<AiProviderError> {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  // Só a mensagem do provedor: o corpo pode ecoar o pedido inteiro.
  const detail = body?.error?.message?.slice(0, 200);

  return new AiProviderError(
    provider,
    response.status,
    `HTTP ${response.status}${detail ? ` — ${detail}` : ''}`,
  );
}

/** O formato de chat da OpenAI — que o Groq implementa igual, noutra URL. */
export class OpenAiCompatibleProvider implements AiProvider {
  constructor(
    readonly name: 'openai' | 'groq',
    private readonly url: string,
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async complete(
    request: AiCompletionRequest,
    signal: AbortSignal,
  ): Promise<string> {
    const response = await this.fetchFn(this.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        // `max_tokens` é recusado pelos modelos novos da OpenAI; este nome
        // vale para todos, e o Groq também aceita.
        max_completion_tokens: request.maxTokens,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.prompt },
        ],
      }),
      signal,
    });

    if (!response.ok) throw await failureOf(this.name, response);

    const data = (await response.json()) as {
      choices?: Array<{
        finish_reason?: string | null;
        message?: { content?: string | null };
      }>;
    };
    const choice = data.choices?.[0];

    // Cortada no limite, ou barrada pelo filtro: não é texto para gravar.
    if (choice?.finish_reason === 'length') {
      throw new AiProviderError(
        this.name,
        null,
        'resposta cortada no limite de tokens',
      );
    }
    if (choice?.finish_reason === 'content_filter') {
      throw new AiProviderError(
        this.name,
        null,
        'barrada pelo filtro de conteúdo',
      );
    }

    return choice?.message?.content ?? '';
  }
}

const PROVIDER_FACTORIES: Record<
  AiProviderName,
  (
    apiKey: string,
    model: string,
    fetchFn: FetchFn,
    config: AiProviderConfig,
  ) => AiProvider
> = {
  anthropic: (apiKey, model, fetchFn, config) =>
    new AnthropicProvider(apiKey, model, config.effort, { fetch: fetchFn }),
  openai: (apiKey, model, fetchFn) =>
    new OpenAiCompatibleProvider(
      'openai',
      'https://api.openai.com/v1/chat/completions',
      apiKey,
      model,
      fetchFn,
    ),
  groq: (apiKey, model, fetchFn) =>
    new OpenAiCompatibleProvider(
      'groq',
      'https://api.groq.com/openai/v1/chat/completions',
      apiKey,
      model,
      fetchFn,
    ),
};

/**
 * Monta a cascata na ordem pedida, pulando provedor sem chave, nome
 * desconhecido e repetição.
 */
export function buildProviders(
  order: string[],
  configs: Partial<Record<AiProviderName, AiProviderConfig>>,
  fetchFn: FetchFn = fetch,
): AiProvider[] {
  const seen = new Set<string>();
  const providers: AiProvider[] = [];

  for (const raw of order) {
    const name = raw.trim().toLowerCase();

    if (
      seen.has(name) ||
      !(AI_PROVIDER_NAMES as readonly string[]).includes(name)
    ) {
      continue;
    }
    seen.add(name);

    const config = configs[name as AiProviderName];
    const apiKey = config?.apiKey?.trim();

    if (config && apiKey) {
      providers.push(
        PROVIDER_FACTORIES[name as AiProviderName](
          apiKey,
          config.model,
          fetchFn,
          config,
        ),
      );
    }
  }

  return providers;
}
