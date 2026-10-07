import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { AiTextService } from '../../ai/ai-text.service';
import { BlogTranslationService, parseArray } from './blog-translation.service';

function servico(resposta: string) {
  const complete = jest
    .fn()
    .mockResolvedValue({ text: resposta, generatedBy: 'x/y' });
  const ai = { enabled: true, complete } as unknown as AiTextService;
  return { service: new BlogTranslationService(ai), complete };
}

describe('BlogTranslationService', () => {
  it('manda só os textos não vazios e devolve na ordem original', async () => {
    const { service, complete } = servico('["Hello", "world"]');
    const out = await service.translate(['Olá', '  ', 'mundo'], 'pt', 'en');
    expect(out).toEqual(['Hello', '  ', 'world']);
    expect(JSON.parse(complete.mock.calls[0][0].prompt)).toEqual([
      'Olá',
      'mundo',
    ]);
  });

  it('mesmo idioma não chama o modelo', async () => {
    const { service, complete } = servico('[]');
    expect(await service.translate(['a'], 'en', 'en')).toEqual(['a']);
    expect(complete).not.toHaveBeenCalled();
  });

  it('recusa resposta com outro tamanho', async () => {
    const { service } = servico('["só um"]');
    await expect(
      service.translate(['a', 'b'], 'pt', 'en'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('recusa texto longo demais', async () => {
    const { service } = servico('[]');
    await expect(
      service.translate(['x'.repeat(60_001)], 'pt', 'en'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('aceita o JSON cercado de crases', () => {
    expect(parseArray('```json\n["a","b"]\n```')).toEqual(['a', 'b']);
    expect(parseArray('[1, 2]')).toBeNull();
    expect(parseArray('nada')).toBeNull();
  });
});
