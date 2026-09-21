import {
  AiProviderError,
  buildProviders,
  OpenAiCompatibleProvider,
} from './ai-providers';

const request = { system: 'sistema', prompt: 'pergunta', maxTokens: 100 };
const signal = new AbortController().signal;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const provider = (fetchFn: jest.Mock, name: 'openai' | 'groq' = 'groq') =>
  new OpenAiCompatibleProvider(
    name,
    'https://groq/x',
    'chave',
    'modelo',
    fetchFn,
  );

describe('provedores de IA no formato de chat da OpenAI (OpenAI, Groq)', () => {
  it('manda sistema e usuário, com max_completion_tokens', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        choices: [{ finish_reason: 'stop', message: { content: 'texto' } }],
      }),
    );

    await expect(provider(fetchFn).complete(request, signal)).resolves.toBe(
      'texto',
    );

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://groq/x');
    expect(init.headers).toMatchObject({ authorization: 'Bearer chave' });
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'modelo',
      max_completion_tokens: 100,
      messages: [
        { role: 'system', content: 'sistema' },
        { role: 'user', content: 'pergunta' },
      ],
    });
  });

  it('sem escolha na resposta é texto vazio', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { choices: [] }));

    await expect(
      provider(fetchFn, 'openai').complete(request, signal),
    ).resolves.toBe('');
  });

  // Biografia pela metade não pode ser gravada como pronta.
  it('resposta cortada no limite é falha', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        choices: [
          {
            finish_reason: 'length',
            message: { content: 'Frédéric Chopin nas' },
          },
        ],
      }),
    );

    await expect(provider(fetchFn).complete(request, signal)).rejects.toThrow(
      'resposta cortada no limite de tokens',
    );
  });

  it('resposta barrada pelo filtro é falha', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        choices: [
          { finish_reason: 'content_filter', message: { content: '' } },
        ],
      }),
    );

    await expect(provider(fetchFn).complete(request, signal)).rejects.toThrow(
      'barrada pelo filtro de conteúdo',
    );
  });

  it('erro HTTP vira AiProviderError com a mensagem do provedor', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(429, { error: { message: 'rate limited' } }),
      );

    const error = await provider(fetchFn, 'openai')
      .complete(request, signal)
      .catch((e) => e);
    expect(error).toBeInstanceOf(AiProviderError);
    expect(error).toMatchObject({
      provider: 'openai',
      status: 429,
      message: 'HTTP 429 — rate limited',
    });
  });

  it('corpo de erro que não é JSON ainda dá mensagem', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(new Response('<html>', { status: 502 }));

    await expect(provider(fetchFn).complete(request, signal)).rejects.toThrow(
      'HTTP 502',
    );
  });
});

describe('buildProviders', () => {
  const configs = {
    anthropic: { apiKey: 'a', model: 'claude' },
    openai: { apiKey: 'o', model: 'gpt' },
    groq: { apiKey: 'g', model: 'llama' },
  };

  it('respeita a ordem pedida', () => {
    const chain = buildProviders(['groq', 'anthropic', 'openai'], configs);

    expect(chain.map((p) => p.name)).toEqual(['groq', 'anthropic', 'openai']);
    expect(chain.map((p) => p.model)).toEqual(['llama', 'claude', 'gpt']);
  });

  it('pula provedor sem chave, nome desconhecido e repetição', () => {
    const chain = buildProviders(
      [' OpenAI ', 'gemini', 'openai', 'anthropic', 'groq'],
      { ...configs, anthropic: { apiKey: '  ', model: 'claude' } },
    );

    expect(chain.map((p) => p.name)).toEqual(['openai', 'groq']);
  });

  it('provedor fora da configuração não entra', () => {
    expect(buildProviders(['anthropic'], {})).toEqual([]);
  });
});
