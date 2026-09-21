import { ConfigService } from '@nestjs/config';
import { AiTextService, AiUnavailableError } from './ai-text.service';

const request = { system: 's', prompt: 'p', maxTokens: 10 };

function configWith(ai: Record<string, unknown> | undefined): ConfigService {
  return { get: jest.fn().mockReturnValue(ai) } as unknown as ConfigService;
}

const allKeys = {
  providerOrder: ['anthropic', 'openai', 'groq'],
  timeoutMs: 5000,
  anthropic: { apiKey: 'a', model: 'claude-opus-5', effort: 'medium' },
  openai: { apiKey: 'o', model: 'gpt-4o-mini' },
  groq: { apiKey: 'g', model: 'openai/gpt-oss-120b' },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// O SDK da Anthropic recebe o mesmo `fetch` que os outros provedores.
const anthropicOk = (text: string) =>
  json(200, {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 },
  });
const chatOk = (text: string) =>
  json(200, {
    choices: [{ finish_reason: 'stop', message: { content: text } }],
  });

describe('AiTextService', () => {
  it('responde com o primeiro da cascata e diz quem foi', async () => {
    const fetchFn = jest.fn().mockResolvedValue(anthropicOk('  texto  '));
    const service = new AiTextService(configWith(allKeys), fetchFn);

    await expect(service.complete(request)).resolves.toEqual({
      text: 'texto',
      generatedBy: 'anthropic/claude-opus-5',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('falha de um passa para o próximo, na ordem', async () => {
    const fetchFn = jest
      .fn()
      // 400 não é repetido pelo SDK: a cascata segue direto.
      .mockResolvedValueOnce(
        json(400, {
          type: 'error',
          error: { type: 'invalid_request_error', message: 'x' },
        }),
      )
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(chatOk('do groq'));
    const service = new AiTextService(configWith(allKeys), fetchFn);

    await expect(service.complete(request)).resolves.toEqual({
      text: 'do groq',
      generatedBy: 'groq/openai/gpt-oss-120b',
    });
    const urls = fetchFn.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toContain('https://api.anthropic.com/v1/messages');
    expect(urls.slice(1)).toEqual([
      'https://api.openai.com/v1/chat/completions',
      'https://api.groq.com/openai/v1/chat/completions',
    ]);
  });

  it('resposta vazia conta como falha', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(anthropicOk('   '))
      .mockResolvedValueOnce(chatOk('ok'));
    const service = new AiTextService(configWith(allKeys), fetchFn);

    await expect(service.complete(request)).resolves.toMatchObject({
      generatedBy: 'openai/gpt-4o-mini',
    });
  });

  it('todos falhando: erro com o motivo de cada um', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('fora do ar'));
    const service = new AiTextService(
      configWith({ ...allKeys, providerOrder: ['openai', 'groq'] }),
      fetchFn,
    );

    const error = await service.complete(request).catch((e) => e);
    expect(error).toBeInstanceOf(AiUnavailableError);
    expect(error.message).toContain('openai/gpt-4o-mini: fora do ar');
    expect(error.message).toContain('groq/openai/gpt-oss-120b: fora do ar');
  });

  it('a ordem é a da configuração', () => {
    const service = new AiTextService(
      configWith({ ...allKeys, providerOrder: ['groq', 'anthropic'] }),
      jest.fn(),
    );

    expect(service.chain()).toEqual([
      'groq/openai/gpt-oss-120b',
      'anthropic/claude-opus-5',
    ]);
  });

  it('sem chave nenhuma fica desligado e recusa', async () => {
    const service = new AiTextService(configWith(undefined), jest.fn());

    expect(service.enabled).toBe(false);
    await expect(service.complete(request)).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
  });
});
