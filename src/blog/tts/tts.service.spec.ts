import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppCacheService } from '../../common/cache/cache.service';
import { CloudinaryService } from '../../common/storage/cloudinary.service';
import { StorageService } from '../../common/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TtsService } from './tts.service';

const ARTICLE = '690273c1ecac0fb66b3844e7';
const ADMIN = { sub: '690273c1ecac0fb66b3844bb', role: 2 };
const READER = { sub: '690273c1ecac0fb66b3844cc', role: 0 };
const LEGACY_URL =
  'https://res.cloudinary.com/dikufxgpb/video/upload/v1761768436/blog/tts/690273c1ecac0fb66b3844e7/tts_audio_1761768434866.mp3';

const article = (overrides: Record<string, unknown> = {}) => ({
  id: ARTICLE,
  title: 'Chopin',
  description: null,
  content: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Nasceu em 1810' }],
      },
    ],
  },
  status: 'PUBLISHED',
  publishedAt: new Date(Date.now() - 60_000),
  ttsAudioUrl: null,
  ...overrides,
});

describe('TtsService', () => {
  let prisma: {
    blogArticle: { findUnique: jest.Mock; update: jest.Mock };
    storedAsset: { findMany: jest.Mock; findFirst: jest.Mock };
  };
  let storage: { uploadFile: jest.Mock; deleteAsset: jest.Mock };
  let cloudinary: { deleteAsset: jest.Mock };
  let synthesizer: { synthesize: jest.Mock };
  let service: TtsService;

  beforeEach(() => {
    prisma = {
      blogArticle: {
        findUnique: jest.fn().mockResolvedValue(article()),
        update: jest.fn().mockResolvedValue({}),
      },
      storedAsset: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    storage = {
      uploadFile: jest.fn().mockResolvedValue({
        id: 'asset-tts',
        secureUrl:
          'https://res.cloudinary.com/x/video/upload/v1/opus/dev/blog/tts/novo.mp3',
        bytes: 1234,
      }),
      deleteAsset: jest.fn().mockResolvedValue(undefined),
    };
    cloudinary = { deleteAsset: jest.fn().mockResolvedValue(undefined) };
    synthesizer = {
      synthesize: jest.fn().mockResolvedValue(Buffer.from([0xff, 0xfb, 1, 2])),
    };
    service = new TtsService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      cloudinary as unknown as CloudinaryService,
      { invalidateMany: jest.fn() } as unknown as AppCacheService,
      synthesizer,
    );
  });

  it('quem lê recebe o áudio que já existe, sem gerar nada', async () => {
    prisma.blogArticle.findUnique.mockResolvedValue(
      article({ ttsAudioUrl: LEGACY_URL }),
    );

    const result = await service.audio({ articleId: ARTICLE }, READER);

    expect(result).toMatchObject({ cached: true, audioUrl: LEGACY_URL });
    expect(synthesizer.synthesize).not.toHaveBeenCalled();
  });

  // No legado, sem autenticação: qualquer um disparava síntese paga.
  it('sem áudio, quem não é administrador não gera', async () => {
    await expect(
      service.audio({ articleId: ARTICLE }, READER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.audio({ articleId: ARTICLE })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(synthesizer.synthesize).not.toHaveBeenCalled();
  });

  // No legado, `regenerate` com texto próprio trocava o áudio da matéria.
  it('regerar também é só da administração', async () => {
    prisma.blogArticle.findUnique.mockResolvedValue(
      article({ ttsAudioUrl: LEGACY_URL }),
    );

    await expect(
      service.audio({ articleId: ARTICLE, regenerate: true }, READER),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('o texto lido sai do artigo, não da requisição', async () => {
    await service.audio(
      { articleId: ARTICLE, text: 'texto de um estranho' } as never,
      ADMIN,
    );

    expect(synthesizer.synthesize).toHaveBeenCalledWith(
      'Chopin. Nasceu em 1810.',
      'pt-BR-Neural2-A',
      1,
    );
  });

  it('gera, guarda como áudio do artigo e grava o endereço', async () => {
    const result = await service.audio({ articleId: ARTICLE }, ADMIN);

    expect(storage.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'BLOG_TTS_AUDIO',
        entityType: 'blogArticle',
        entityId: ARTICLE,
      }),
      expect.objectContaining({ originalName: 'tts.mp3' }),
    );
    expect(prisma.blogArticle.update).toHaveBeenCalledWith({
      where: { id: ARTICLE },
      data: { ttsAudioUrl: result.audioUrl },
    });
    expect(result).toMatchObject({ cached: false, chunks: 1 });
  });

  // O legado errava o identificador, e o áudio antigo ficava no Cloudinary.
  it('ao regerar, apaga o áudio do legado pelo identificador certo', async () => {
    prisma.blogArticle.findUnique.mockResolvedValue(
      article({ ttsAudioUrl: LEGACY_URL }),
    );

    await service.audio({ articleId: ARTICLE, regenerate: true }, ADMIN);

    expect(cloudinary.deleteAsset).toHaveBeenCalledWith(
      'blog/tts/690273c1ecac0fb66b3844e7/tts_audio_1761768434866',
      'VIDEO',
    );
  });

  it('artigo não publicado é 404 para quem lê', async () => {
    prisma.blogArticle.findUnique.mockResolvedValue(
      article({ status: 'DRAFT', publishedAt: null }),
    );

    await expect(
      service.audio({ articleId: ARTICLE }, READER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('artigo acima do teto de caracteres é recusado antes de gastar', async () => {
    prisma.blogArticle.findUnique.mockResolvedValue(
      article({
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'a'.repeat(70_000) }],
            },
          ],
        },
      }),
    );

    await expect(service.audio({ articleId: ARTICLE }, ADMIN)).rejects.toThrow(
      /60000/,
    );
    expect(synthesizer.synthesize).not.toHaveBeenCalled();
  });

  describe('tamanho do áudio, conferido antes de sintetizar', () => {
    const withText = (text: string) =>
      article({
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        },
      });
    // ~29 mil caracteres: a maior matéria da base.
    const LONGEST = 'Chopin nasceu em 1810, na Polônia. '.repeat(825);

    it('a maior matéria da base, na velocidade normal, cabe', async () => {
      prisma.blogArticle.findUnique.mockResolvedValue(withText(LONGEST));

      await service.audio({ articleId: ARTICLE }, ADMIN);

      expect(synthesizer.synthesize).toHaveBeenCalled();
    });

    // 40 mil caracteres dariam ~28 MB; o limite do upload é 25.
    it('o que passaria do limite do upload é recusado sem gastar', async () => {
      prisma.blogArticle.findUnique.mockResolvedValue(
        withText('Chopin nasceu em 1810, na Polônia. '.repeat(1143)),
      );

      await expect(
        service.audio({ articleId: ARTICLE }, ADMIN),
      ).rejects.toThrow(/limite é 25 MB/);
      expect(synthesizer.synthesize).not.toHaveBeenCalled();
    });

    // A 0,5, o áudio dobra.
    it('a velocidade lenta conta', async () => {
      prisma.blogArticle.findUnique.mockResolvedValue(withText(LONGEST));

      await expect(
        service.audio({ articleId: ARTICLE, speakingRate: 0.5 }, ADMIN),
      ).rejects.toThrow(/velocidade maior/);
      expect(synthesizer.synthesize).not.toHaveBeenCalled();
    });
  });

  it('Google não configurado vira 503, sem gravar nada', async () => {
    synthesizer.synthesize.mockRejectedValue(
      new ServiceUnavailableException('Texto para voz não configurado'),
    );

    await expect(
      service.audio({ articleId: ARTICLE }, ADMIN),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  it('apagar tira o áudio registrado e o do legado', async () => {
    prisma.blogArticle.findUnique.mockResolvedValue(
      article({ ttsAudioUrl: LEGACY_URL }),
    );
    prisma.storedAsset.findMany.mockResolvedValue([
      { id: 'a1', secureUrl: 'https://outro' },
    ]);

    await service.remove(ARTICLE);

    expect(storage.deleteAsset).toHaveBeenCalledWith('a1');
    expect(cloudinary.deleteAsset).toHaveBeenCalled();
    expect(prisma.blogArticle.update).toHaveBeenCalledWith({
      where: { id: ARTICLE },
      data: { ttsAudioUrl: null },
    });
  });
});
