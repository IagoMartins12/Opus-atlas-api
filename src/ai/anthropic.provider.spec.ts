import Anthropic from '@anthropic-ai/sdk';
import { AiProviderError } from './ai-providers';
import { AnthropicProvider } from './anthropic.provider';

const request = { system: 'sistema', prompt: 'pergunta', maxTokens: 8000 };
const signal = new AbortController().signal;

const message = (overrides: Record<string, unknown> = {}) => ({
  content: [
    { type: 'thinking', thinking: '' },
    { type: 'text', text: 'Olá, ' },
    { type: 'text', text: 'mundo' },
  ],
  stop_reason: 'end_turn',
  stop_details: null,
  ...overrides,
});

describe('AnthropicProvider', () => {
  let create: jest.Mock;
  let provider: AnthropicProvider;

  beforeEach(() => {
    create = jest.fn().mockResolvedValue(message());
    provider = new AnthropicProvider('chave', 'claude-opus-5', 'low', {
      client: { beta: { messages: { create } } } as never,
    });
  });

  it('pede com esforço, desvio de recusa e o sinal de cancelamento', async () => {
    await provider.complete(request, signal);

    expect(create).toHaveBeenCalledWith(
      {
        model: 'claude-opus-5',
        max_tokens: 8000,
        system: 'sistema',
        messages: [{ role: 'user', content: 'pergunta' }],
        output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      },
      { signal },
    );
  });

  it('junta só os blocos de texto — o de pensamento fica de fora', async () => {
    await expect(provider.complete(request, signal)).resolves.toBe(
      'Olá, mundo',
    );
  });

  // Biografia pela metade não pode ser gravada como pronta.
  it('resposta cortada no limite é falha, para a cascata seguir', async () => {
    create.mockResolvedValue(message({ stop_reason: 'max_tokens' }));

    await expect(provider.complete(request, signal)).rejects.toThrow(
      'resposta cortada no limite de tokens',
    );
  });

  it('recusa que sobrou depois do desvio é falha, com a categoria', async () => {
    create.mockResolvedValue(
      message({ stop_reason: 'refusal', stop_details: { category: 'cyber' } }),
    );
    await expect(provider.complete(request, signal)).rejects.toThrow(
      'recusou (cyber)',
    );

    create.mockResolvedValue(
      message({ stop_reason: 'refusal', stop_details: null }),
    );
    await expect(provider.complete(request, signal)).rejects.toThrow(
      'recusou (sem categoria)',
    );
  });

  it('erro da API vira AiProviderError com o status', async () => {
    create.mockRejectedValue(
      Anthropic.APIError.generate(
        429,
        { error: { message: 'devagar' } },
        'devagar',
        new Headers(),
      ),
    );

    const error = await provider.complete(request, signal).catch((e) => e);
    expect(error).toBeInstanceOf(AiProviderError);
    expect(error).toMatchObject({ provider: 'anthropic', status: 429 });
    expect(error.message).toMatch(/^HTTP 429 — /);
  });

  it('erro que não é da API sobe como está', async () => {
    create.mockRejectedValue(new TypeError('bug'));

    await expect(provider.complete(request, signal)).rejects.toBeInstanceOf(
      TypeError,
    );
  });

  it('sem cliente injetado, cria o do SDK com a chave', () => {
    const real = new AnthropicProvider('chave', 'claude-opus-5');

    expect(real.name).toBe('anthropic');
    expect(real.model).toBe('claude-opus-5');
  });
});
