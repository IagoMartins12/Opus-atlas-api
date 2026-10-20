import { composerDetailCacheKey } from './composer-cache-keys';
import {
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiTextService, AiUnavailableError } from '../../ai/ai-text.service';
import { AppCacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ComposerBioService } from './composer-bio.service';

const ID = '68600fb6df23f271f94bb803';

/** O dia do teto (fuso de São Paulo), como o serviço o calcula. */
const hoje = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(),
  );
const PT =
  'Frédéric Chopin foi um compositor e pianista polonês do período romântico.';
const EN =
  'Frédéric Chopin was a Polish composer and pianist of the Romantic era.';

const composerRow = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  name: 'Chopin',
  fullName: 'Frédéric Chopin',
  alternativeNames: null,
  birthDate: '1810',
  deathDate: '1849',
  epochName: null,
  nationality: 'Polonês',
  instruments: 'Piano',
  bio: null,
  bioEn: null,
  bioGeneratedBy: null,
  epoch: { name: 'Romântico' },
  primaryRole: { name: 'Compositor' },
  ...overrides,
});

describe('ComposerBioService', () => {
  let prisma: {
    composer: { findUnique: jest.Mock; update: jest.Mock };
  };
  let ai: { enabled: boolean; complete: jest.Mock };
  let cache: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let store: Map<string, unknown>;
  let service: ComposerBioService;

  beforeEach(() => {
    store = new Map();
    prisma = {
      composer: {
        findUnique: jest.fn().mockResolvedValue(composerRow()),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    ai = {
      enabled: true,
      complete: jest.fn().mockResolvedValue({
        text: PT,
        generatedBy: 'anthropic/claude-opus-5',
      }),
    };
    cache = {
      get: jest.fn((key: string) => Promise.resolve(store.get(key))),
      set: jest.fn((key: string, value: unknown) => {
        store.set(key, value);
        return Promise.resolve();
      }),
      del: jest.fn().mockResolvedValue(undefined),
    };
    service = new ComposerBioService(
      prisma as unknown as PrismaService,
      ai as unknown as AiTextService,
      cache as unknown as AppCacheService,
      { get: jest.fn().mockReturnValue(3) } as unknown as ConfigService,
    );
  });

  it('biografia gravada volta sem chamar a IA', async () => {
    prisma.composer.findUnique.mockResolvedValue(
      composerRow({ bio: `  ${PT}  `, bioGeneratedBy: 'groq/llama' }),
    );

    await expect(service.biography(ID, 'pt')).resolves.toEqual({
      biography: PT,
      language: 'pt',
      source: 'database',
      generatedBy: 'groq/llama',
    });
    expect(ai.complete).not.toHaveBeenCalled();
  });

  it('sem biografia: gera, grava com a origem e limpa o cache do detalhe', async () => {
    await expect(service.biography(ID, 'pt')).resolves.toEqual({
      biography: PT,
      language: 'pt',
      source: 'generated',
      generatedBy: 'anthropic/claude-opus-5',
    });

    expect(prisma.composer.update).toHaveBeenCalledWith({
      where: { id: ID },
      data: expect.objectContaining({
        bio: PT,
        bioGeneratedBy: 'anthropic/claude-opus-5',
        bioGeneratedAt: expect.any(Date),
      }),
    });
    expect(cache.del).toHaveBeenCalledWith(composerDetailCacheKey(ID));
    // O prompt leva o que o catálogo sabe.
    const [{ prompt }] = ai.complete.mock.calls[0] as [{ prompt: string }];
    expect(prompt).toContain('- Período: Romântico');
  });

  it('inglês com português gravado: traduz e grava o inglês', async () => {
    prisma.composer.findUnique.mockResolvedValue(composerRow({ bio: PT }));
    ai.complete.mockResolvedValue({ text: EN, generatedBy: 'openai/gpt' });

    await expect(service.biography(ID, 'en')).resolves.toMatchObject({
      biography: EN,
      source: 'translated',
    });
    expect(ai.complete).toHaveBeenCalledTimes(1);
    expect(prisma.composer.update).toHaveBeenCalledWith({
      where: { id: ID },
      data: { bioEn: EN },
    });
  });

  it('inglês sem nada: gera o português e traduz', async () => {
    ai.complete
      .mockResolvedValueOnce({ text: PT, generatedBy: 'anthropic/x' })
      .mockResolvedValueOnce({ text: EN, generatedBy: 'anthropic/x' });

    await expect(service.biography(ID, 'en')).resolves.toMatchObject({
      biography: EN,
      source: 'generated',
      generatedBy: 'anthropic/x',
    });
    expect(prisma.composer.update).toHaveBeenCalledTimes(2);
  });

  it('a IA não conhece: sem biografia, e não pergunta de novo', async () => {
    ai.complete.mockResolvedValue({ text: 'SEM_BIOGRAFIA', generatedBy: 'x' });

    await expect(service.biography(ID, 'pt')).resolves.toEqual({
      biography: null,
      language: 'pt',
      status: 'unavailable',
    });
    expect(prisma.composer.update).not.toHaveBeenCalled();

    await service.biography(ID, 'en');
    expect(ai.complete).toHaveBeenCalledTimes(1);
  });

  it('duas visitas ao mesmo tempo esperam a mesma geração', async () => {
    await Promise.all([
      service.biography(ID, 'pt'),
      service.biography(ID, 'pt'),
    ]);

    expect(ai.complete).toHaveBeenCalledTimes(1);
  });

  it('demorou: responde "gerando" e a geração termina e grava', async () => {
    let finish!: (value: unknown) => void;
    ai.complete.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    await expect(service.biography(ID, 'pt', 5)).resolves.toEqual({
      biography: null,
      language: 'pt',
      status: 'generating',
      retryAfter: 15,
    });

    finish({ text: PT, generatedBy: 'anthropic/x' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(prisma.composer.update).toHaveBeenCalled();
  });

  describe('custo', () => {
    // No teto, o compositor fica sem biografia: nada gravado, nada marcado
    // como "já perguntado", e a página recebe um estado calmo — não um erro.
    it('teto de hoje acabou: a página recebe "cota", sem IA, sem gravar e sem marcar', async () => {
      cache.get.mockImplementation((key: string) =>
        Promise.resolve(key === `ai-bio:budget:${hoje()}` ? 3 : undefined),
      );

      await expect(service.biography(ID, 'pt')).resolves.toEqual({
        biography: null,
        language: 'pt',
        status: 'quota',
      });

      expect(ai.complete).not.toHaveBeenCalled();
      expect(prisma.composer.update).not.toHaveBeenCalled();
      // Nem a marca de "a IA não conhece este compositor" (30 dias fora): amanhã tenta.
      expect(cache.set).not.toHaveBeenCalledWith(
        expect.stringContaining('ai-bio:unknown:'),
        expect.anything(),
        expect.anything(),
      );
    });

    it('quem chama o rascunho ou a tradução direto continua recebendo 429', async () => {
      cache.get.mockImplementation((key: string) =>
        Promise.resolve(key.startsWith('ai-bio:budget') ? 1_000 : undefined),
      );

      const draft = await service
        .draft({ name: 'Bach' } as never, 'pt')
        .catch((e) => e);
      expect((draft as HttpException).getStatus()).toBe(429);

      const translation = await service.translateText(PT).catch((e) => e);
      expect((translation as HttpException).getStatus()).toBe(429);
      expect(ai.complete).not.toHaveBeenCalled();
    });

    // A unidade do teto é o compositor; a tradução (a versão em inglês de cada
    // um) tem teto próprio, o dobro.
    it('gerar e traduzir gastam tetos diferentes', async () => {
      ai.complete
        .mockResolvedValueOnce({ text: PT, generatedBy: 'anthropic/x' })
        .mockResolvedValueOnce({ text: EN, generatedBy: 'anthropic/x' });

      await service.biography(ID, 'en');

      expect(store.get(`ai-bio:budget:${hoje()}`)).toBe(1);
      expect(store.get(`ai-bio:budget-translation:${hoje()}`)).toBe(1);
    });

    it('teto de geração cheio não impede traduzir um texto que já existe', async () => {
      prisma.composer.findUnique.mockResolvedValue(composerRow({ bio: PT }));
      ai.complete.mockResolvedValue({ text: EN, generatedBy: 'openai/gpt' });
      store.set(`ai-bio:budget:${hoje()}`, 3);

      await expect(service.biography(ID, 'en')).resolves.toMatchObject({
        biography: EN,
        source: 'translated',
      });
    });

    it('geração feita e tradução sem teto: o português fica gravado, o inglês fica para amanhã', async () => {
      ai.complete.mockResolvedValueOnce({
        text: PT,
        generatedBy: 'anthropic/x',
      });
      store.set(`ai-bio:budget-translation:${hoje()}`, 6);

      await expect(service.biography(ID, 'en')).resolves.toEqual({
        biography: null,
        language: 'en',
        status: 'quota',
      });

      expect(prisma.composer.update).toHaveBeenCalledTimes(1);
      expect(prisma.composer.update).toHaveBeenCalledWith({
        where: { id: ID },
        data: expect.objectContaining({ bio: PT }),
      });
    });

    it('cada chamada conta no teto do dia, mesmo a que falha', async () => {
      ai.complete.mockRejectedValue(new AiUnavailableError('todos caíram'));

      await expect(service.biography(ID, 'pt')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      const budget = [...store.entries()].find(([key]) =>
        key.startsWith('ai-bio:budget:'),
      );
      expect(budget?.[1]).toBe(1);
    });

    it('sem provedor configurado é 503', async () => {
      ai.enabled = false;

      await expect(service.biography(ID, 'pt')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('além de duas gerações simultâneas é 503', async () => {
      ai.complete.mockReturnValue(new Promise(() => undefined));
      const others = ['68600fb6df23f271f94bb804', '68600fb6df23f271f94bb805'];
      prisma.composer.findUnique.mockImplementation(({ where }) =>
        Promise.resolve(composerRow({ id: where.id })),
      );

      await Promise.all(others.map((id) => service.biography(id, 'pt', 5)));

      await expect(service.biography(ID, 'pt', 5)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('erro inesperado sobe como está', async () => {
      ai.complete.mockRejectedValue(new TypeError('bug'));

      await expect(service.biography(ID, 'pt')).rejects.toBeInstanceOf(
        TypeError,
      );
    });
  });

  describe('rascunho e tradução (cadastro)', () => {
    it('o rascunho gera sem gravar nada', async () => {
      await expect(
        service.draft(
          { name: 'Villa-Lobos', fullName: 'Heitor Villa-Lobos' },
          'pt',
        ),
      ).resolves.toEqual({
        biography: PT,
        language: 'pt',
        source: 'generated',
        generatedBy: 'anthropic/claude-opus-5',
      });
      expect(prisma.composer.update).not.toHaveBeenCalled();
    });

    it('o rascunho em inglês gera o português e traduz', async () => {
      ai.complete
        .mockResolvedValueOnce({ text: PT, generatedBy: 'groq/llama' })
        .mockResolvedValueOnce({
          text: ' English ',
          generatedBy: 'groq/llama',
        });

      await expect(
        service.draft({ name: 'Villa-Lobos', fullName: 'Villa-Lobos' }, 'en'),
      ).resolves.toEqual(
        expect.objectContaining({ biography: 'English', language: 'en' }),
      );
      expect(ai.complete).toHaveBeenCalledTimes(2);
    });

    it('a IA não conhece: sem rascunho', async () => {
      ai.complete.mockResolvedValue({
        text: 'SEM_BIOGRAFIA',
        generatedBy: 'groq/llama',
      });

      await expect(
        service.draft({ name: 'Ninguém', fullName: 'Ninguém' }, 'pt'),
      ).resolves.toEqual({
        biography: null,
        language: 'pt',
        status: 'unavailable',
      });
    });

    it('traduz o texto do formulário, sem gravar', async () => {
      ai.complete.mockResolvedValue({ text: ' Text ', generatedBy: 'x/y' });

      await expect(service.translateText(PT)).resolves.toBe('Text');
      expect(prisma.composer.update).not.toHaveBeenCalled();
    });
  });

  it('id inválido ou inexistente é 404', async () => {
    await expect(service.biography('abc', 'pt')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    prisma.composer.findUnique.mockResolvedValue(null);
    await expect(service.biography(ID, 'pt')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
