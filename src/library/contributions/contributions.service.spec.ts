import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppCacheService } from '../../common/cache/cache.service';
import { ActivityTracker } from '../../common/events/activity-tracker.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  canonicalYoutubeUrl,
  DAILY_XP_CONTRIBUTIONS,
} from './contribution-rules';
import { ContributionsService } from './contributions.service';

const author = {
  id: 'user-1',
  firstName: 'Clara',
  lastName: 'Schumann',
  username: null,
};
const longBio = 'Uma biografia revista com cuidado. '.repeat(12);

describe('ContributionsService', () => {
  let service: ContributionsService;
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    composer: { findUnique: jest.Mock; update: jest.Mock };
    work: { findUnique: jest.Mock; update: jest.Mock };
    contribution: {
      create: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    composerCuriosity: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      delete: jest.Mock;
    };
  };
  let activity: { track: jest.Mock };
  let cache: { invalidateMany: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ emailVerified: new Date() }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      composer: {
        findUnique: jest.fn().mockResolvedValue({ id: 'c-1', bio: 'Antiga' }),
        update: jest.fn().mockResolvedValue({}),
      },
      work: {
        findUnique: jest.fn().mockResolvedValue({ compositionYear: '1820' }),
        update: jest.fn().mockResolvedValue({}),
      },
      contribution: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'k-1',
            createdAt: new Date(),
            user: author,
            ...data,
          }),
        ),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      composerCuriosity: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'q-1',
            isHidden: null,
            user: author,
            ...data,
          }),
        ),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    activity = { track: jest.fn() };
    cache = { invalidateMany: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContributionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AppCacheService, useValue: cache },
        { provide: ActivityTracker, useValue: activity },
      ],
    }).compile();
    service = module.get(ContributionsService);
  });

  describe('contribute', () => {
    const bio = {
      entityType: 'composer' as const,
      entityId: 'c-1',
      field: 'bio',
      value: longBio,
    };

    it('aplica na hora, guarda o valor anterior e paga o XP', async () => {
      const result = await service.contribute('user-1', bio);

      expect(prisma.composer.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: expect.objectContaining({
          bio: longBio.trim(),
          bioGeneratedBy: null,
        }),
      });
      expect(prisma.contribution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: 'BIO',
            before: 'Antiga',
            xp: 20,
          }),
        }),
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { totalXP: { increment: 20 } },
      });
      expect(activity.track).toHaveBeenCalledWith(
        'user-1',
        'contributions',
        'contribution.bio',
      );
      expect(result.author.name).toBe('Clara Schumann');
    });

    it('exige e-mail confirmado', async () => {
      prisma.user.findUnique.mockResolvedValue({ emailVerified: null });

      await expect(service.contribute('user-1', bio)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.composer.update).not.toHaveBeenCalled();
    });

    // Nome, título e catálogo mudam o que o registro é: seguem com o dono.
    it('recusa campo fora da lista', async () => {
      await expect(
        service.contribute('user-1', { ...bio, field: 'fullName', value: 'X' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa biografia curta demais', async () => {
      await expect(
        service.contribute('user-1', { ...bio, value: 'Curta.' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa valor igual ao atual', async () => {
      prisma.work.findUnique.mockResolvedValue({ compositionYear: '1820' });

      await expect(
        service.contribute('user-1', {
          entityType: 'work',
          entityId: 'w-1',
          field: 'compositionYear',
          value: ' 1820 ',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('vídeo vira o link canônico do YouTube', async () => {
      await service.contribute('user-1', {
        ...bio,
        field: 'videoUrl',
        value: 'https://youtu.be/dQw4w9WgXcQ?t=30',
      });

      expect(prisma.composer.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: { videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      });
    });

    it('data corrigida atualiza as colunas numéricas', async () => {
      await service.contribute('user-1', {
        ...bio,
        field: 'birthDate',
        value: '17 de dezembro de 1770',
      });

      expect(prisma.composer.update.mock.calls[0][0].data).toMatchObject({
        birthDate: '17 de dezembro de 1770',
        birthYear: 1770,
      });
    });

    it('passado o limite do dia, entra no ar sem XP', async () => {
      prisma.contribution.count.mockResolvedValue(DAILY_XP_CONTRIBUTIONS);

      await service.contribute('user-1', bio);

      expect(prisma.composer.update).toHaveBeenCalled();
      expect(prisma.contribution.create.mock.calls[0][0].data.xp).toBe(0);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('registro inexistente', async () => {
      prisma.composer.findUnique.mockResolvedValue(null);

      await expect(service.contribute('user-1', bio)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('revert', () => {
    const live = {
      id: 'k-1',
      userId: 'user-1',
      entityType: 'composer',
      entityId: 'c-1',
      field: 'bio',
      before: 'Antiga',
      after: 'Nova',
      curiosityId: null,
      xp: 20,
      revertedAt: null,
    };

    it('volta o valor anterior e, removida, tira o XP', async () => {
      prisma.contribution.findUnique.mockResolvedValue(live);
      prisma.composer.findUnique.mockResolvedValue({ bio: 'Nova' });

      await service.revert('k-1', true);

      expect(prisma.composer.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: expect.objectContaining({ bio: 'Antiga' }),
      });
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-1', totalXP: { gte: 20 } },
        data: { totalXP: { decrement: 20 } },
      });
    });

    // Uma edição posterior não some porque a anterior foi desfeita.
    it('não sobrescreve o que mudou depois', async () => {
      prisma.contribution.findUnique.mockResolvedValue(live);
      prisma.composer.findUnique.mockResolvedValue({ bio: 'Outra, mais nova' });

      await service.revert('k-1', false);

      expect(prisma.composer.update).not.toHaveBeenCalled();
      expect(prisma.contribution.update).toHaveBeenCalledWith({
        where: { id: 'k-1' },
        data: { revertedAt: expect.any(Date) },
      });
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('retenção soltada reaplica a contribuição', async () => {
      prisma.contribution.findUnique.mockResolvedValue({
        ...live,
        revertedAt: new Date(),
      });
      prisma.composer.findUnique.mockResolvedValue({ bio: 'Antiga' });

      await service.reapply('k-1');

      expect(prisma.composer.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: expect.objectContaining({ bio: 'Nova' }),
      });
      expect(prisma.contribution.update).toHaveBeenCalledWith({
        where: { id: 'k-1' },
        data: { revertedAt: null },
      });
    });
  });

  describe('curiosidades', () => {
    it('cria a curiosidade, registra a contribuição e paga o XP', async () => {
      const result = await service.addCuriosity('user-1', 'c-1', {
        text: '  Tocava   órgão na igreja da cidade aos doze anos. ',
        language: 'pt',
      });

      expect(
        prisma.composerCuriosity.create.mock.calls[0][0].data,
      ).toMatchObject({
        text: 'Tocava órgão na igreja da cidade aos doze anos.',
        source: 'USER',
      });
      expect(prisma.contribution.create.mock.calls[0][0].data).toMatchObject({
        kind: 'CURIOSITY',
        curiosityId: 'q-1',
        xp: 5,
      });
      expect(result).toMatchObject({ mine: true, held: false });
    });

    it('recusa repetida', async () => {
      prisma.composerCuriosity.findFirst.mockResolvedValue({ id: 'q-0' });

      await expect(
        service.addCuriosity('user-1', 'c-1', {
          text: 'Tocava órgão na igreja da cidade aos doze anos.',
          language: 'pt',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('quem não escreveu não apaga', async () => {
      prisma.composerCuriosity.findUnique.mockResolvedValue({
        userId: 'outro',
      });

      await expect(
        service.removeCuriosity('user-1', false, 'q-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('apagar tira o XP que ela pagou', async () => {
      prisma.composerCuriosity.findUnique.mockResolvedValue({
        userId: 'user-1',
      });
      prisma.contribution.findFirst.mockResolvedValue({
        id: 'k-1',
        userId: 'user-1',
        xp: 5,
      });

      await service.removeCuriosity('user-1', false, 'q-1');

      expect(prisma.composerCuriosity.delete).toHaveBeenCalledWith({
        where: { id: 'q-1' },
      });
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-1', totalXP: { gte: 5 } },
        data: { totalXP: { decrement: 5 } },
      });
    });

    it('lista escondidas só para o autor', async () => {
      await service.listCuriosities('c-1', 'pt', 'user-1');

      expect(prisma.composerCuriosity.findMany.mock.calls[0][0].where).toEqual({
        composerId: 'c-1',
        language: 'pt',
        OR: [{ isHidden: { not: true } }, { userId: 'user-1' }],
      });
    });
  });

  it('aceita os formatos de link do YouTube', () => {
    const id = 'dQw4w9WgXcQ';
    for (const url of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/shorts/${id}`,
    ]) {
      expect(canonicalYoutubeUrl(url)).toBe(
        `https://www.youtube.com/watch?v=${id}`,
      );
    }
    expect(canonicalYoutubeUrl('https://vimeo.com/123')).toBeNull();
  });
});
