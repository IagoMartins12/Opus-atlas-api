import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AppCacheService } from '../../common/cache/cache.service';
import { ActivityTracker } from '../../common/events/activity-tracker.service';
import { StorageService } from '../../common/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadHistoryService } from '../shared/upload-history.service';
import { WorkUploadsService } from './work-uploads.service';

const context = { ipAddress: '203.0.113.10', userAgent: 'jest' };

const createDto = {
  title: 'Noturno',
  composerId: 'c1',
  instrumentId: 'i1',
  epochId: 'e1',
};

describe('WorkUploadsService', () => {
  let prisma: {
    work: {
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
    };
    composer: { findUnique: jest.Mock };
    instrument: { findUnique: jest.Mock };
    epoch: { findUnique: jest.Mock };
    workScore: { count: jest.Mock; findMany: jest.Mock };
    workAnnotation: { count: jest.Mock };
    favoriteWork: { count: jest.Mock };
    wantToLearn: { count: jest.Mock };
    learned: { count: jest.Mock };
  };
  let history: { record: jest.Mock };
  let storage: { deleteByEntity: jest.Mock; findActiveByEntity: jest.Mock };
  let cache: { invalidateMany: jest.Mock };
  let activity: { track: jest.Mock };
  let service: WorkUploadsService;

  beforeEach(() => {
    const count = (n: number) => jest.fn().mockResolvedValue(n);
    prisma = {
      work: {
        create: jest.fn(({ data }) =>
          Promise.resolve({
            id: 'w1',
            ...data,
            composer: {},
            epoch: {},
            instrument: {},
          }),
        ),
        update: jest.fn().mockResolvedValue({ id: 'w1' }),
        delete: jest.fn().mockResolvedValue({}),
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'w1', title: 'Noturno', createdBy: 'u1' }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      composer: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'c1', name: 'Chopin', fullName: null }),
      },
      instrument: {
        findUnique: jest.fn().mockResolvedValue({ id: 'i1', name: 'Piano' }),
      },
      epoch: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'e1', name: 'Romântico' }),
      },
      workScore: {
        count: count(3),
        findMany: jest.fn().mockResolvedValue([
          { id: 's1', title: 'Partitura A', source: 'IMSLP' },
          { id: 's2', title: 'Partitura B', source: 'IMSLP' },
          { id: 's3', title: 'Partitura C', source: 'UPLOAD' },
        ]),
      },
      workAnnotation: { count: count(2) },
      favoriteWork: { count: count(1) },
      wantToLearn: { count: count(0) },
      learned: { count: count(4) },
    };
    history = { record: jest.fn().mockResolvedValue(undefined) };
    storage = {
      deleteByEntity: jest.fn().mockResolvedValue(0),
      findActiveByEntity: jest.fn().mockResolvedValue([{ id: 'f1' }]),
    };
    cache = { invalidateMany: jest.fn().mockResolvedValue(undefined) };
    activity = { track: jest.fn() };
    service = new WorkUploadsService(
      prisma as unknown as PrismaService,
      history as unknown as UploadHistoryService,
      storage as unknown as StorageService,
      cache as unknown as AppCacheService,
      activity as unknown as ActivityTracker,
    );
  });

  describe('criar', () => {
    it('sem mídia: origem "none", campos IMSLP vazios, histórico e cache', async () => {
      await service.create(
        'u1',
        { ...createDto, parentWorkId: '' } as never,
        context,
      );

      const [{ data }] = prisma.work.create.mock.calls[0];
      expect(data).toMatchObject({
        workType: 'INDIVIDUAL',
        parentWorkId: null,
        imslpPermlink: '',
        imslpId: '',
        mediaSource: 'none',
        videoAulaType: null,
        createdBy: 'u1',
        isCustom: true,
      });
      expect(history.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'create',
          changes: expect.objectContaining({
            composerName: 'Chopin',
            dataSource: 'manual',
          }),
        }),
      );
      expect(activity.track).toHaveBeenCalledWith(
        'u1',
        'contributions',
        'contribution.work.created',
      );
      expect(cache.invalidateMany).toHaveBeenCalled();
    });

    it('com videoaula: tipo, fonte e autor preenchidos; origem informada', async () => {
      await service.create(
        'u1',
        {
          ...createDto,
          videoAulaUrl: 'https://youtu.be/x',
          dataSource: 'imslp',
        } as never,
        context,
      );

      expect(prisma.work.create.mock.calls[0][0].data).toMatchObject({
        videoAulaType: 'video',
        videoAulaSource: 'youtube',
        videoAulaAddedBy: 'u1',
        mediaSource: 'imslp',
      });
    });

    it.each([
      ['composer', 'Compositor não encontrado'],
      ['instrument', 'Instrumento não encontrado'],
      ['epoch', 'Época não encontrada'],
    ] as const)('referência inexistente (%s) é 400', async (model, message) => {
      prisma[model].findUnique.mockResolvedValue(null);

      await expect(
        service.create('u1', createDto as never, context),
      ).rejects.toThrow(message);
    });
  });

  describe('editar', () => {
    it('grava só o que veio e registra as mudanças', async () => {
      await service.update(
        'u1',
        false,
        'w1',
        {
          title: 'Novo',
          composerId: 'c1',
          instrumentId: 'i1',
          epochId: 'e1',
          parentWorkId: '',
          movementNumber: 2,
          categoryNames: ['Piano'],
          workGenresArr: ['Noturno'],
          imslpTags: ['tag'],
        } as never,
        context,
      );

      const [{ data }] = prisma.work.update.mock.calls[0];
      expect(data).toEqual({
        title: 'Novo',
        composerId: 'c1',
        instrumentId: 'i1',
        epochId: 'e1',
        parentWorkId: null,
        movementNumber: 2,
        categoryNames: ['Piano'],
        workGenresArr: ['Noturno'],
        imslpTags: ['tag'],
      });
    });

    it('sem troca de referência não confere compositor', async () => {
      await service.update(
        'u1',
        false,
        'w1',
        { tone: 'Mi bemol' } as never,
        context,
      );

      expect(prisma.composer.findUnique).not.toHaveBeenCalled();
    });

    it('obra de outra pessoa é 403; admin pode; inexistente é 404', async () => {
      await expect(
        service.update('outro', false, 'w1', {} as never, context),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.update('outro', true, 'w1', {} as never, context),
      ).resolves.toBeDefined();

      prisma.work.findUnique.mockResolvedValue(null);
      await expect(
        service.update('u1', false, 'x', {} as never, context),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('remover apaga os arquivos antes do registro', async () => {
    await service.remove('u1', false, 'w1', context);

    expect(storage.deleteByEntity).toHaveBeenCalledWith('work', 'w1');
    expect(prisma.work.delete).toHaveBeenCalledWith({ where: { id: 'w1' } });
    expect(history.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete' }),
    );
  });

  it('o que some junto com a obra', async () => {
    await expect(service.cascadeInfo('w1')).resolves.toEqual({
      work: { id: 'w1', title: 'Noturno' },
      scores: [
        { id: 's1', title: 'Partitura A', source: 'IMSLP' },
        { id: 's2', title: 'Partitura B', source: 'IMSLP' },
        { id: 's3', title: 'Partitura C', source: 'UPLOAD' },
      ],
      willDelete: {
        scores: 3,
        annotations: 2,
        favorites: 1,
        wantToLearn: 0,
        learned: 4,
        files: 1,
      },
    });

    prisma.work.findUnique.mockResolvedValue(null);
    await expect(service.cascadeInfo('x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('duplicata', () => {
    const hit = {
      id: 'w9',
      title: 'Noturno',
      subtitle: null,
      opOrCatalog: 'Op. 9',
      imslpPermlink: '',
      composer: { name: 'Chopin', fullName: null },
    };

    it('exige URL, ou título com compositor', async () => {
      await expect(
        service.checkDuplicate({ title: 'x' } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('acha pelo link do IMSLP', async () => {
      prisma.work.findFirst.mockResolvedValueOnce(hit);

      await expect(
        service.checkDuplicate({
          url: ' https://imslp.org/wiki/Nocturnes_(Chopin) ',
        } as never),
      ).resolves.toEqual({
        found: true,
        reason: 'url',
        work: {
          id: 'w9',
          title: 'Noturno',
          subtitle: null,
          opOrCatalog: 'Op. 9',
          imslpPermlink: null,
          composerName: 'Chopin',
        },
      });
    });

    it('acha por título e compositor, escapando o título e ignorando a própria obra', async () => {
      prisma.work.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(hit);

      const result = await service.checkDuplicate({
        url: 'https://x',
        title: 'Op.9 (No. 2)',
        composerId: 'c1',
        excludeId: 'w1',
      } as never);

      expect(result).toMatchObject({ found: true, reason: 'title_composer' });
      const [{ where }] = prisma.work.findFirst.mock.calls[1];
      expect(where.AND[0].title.equals).toBe('Op\\.9 \\(No\\. 2\\)');
      expect(where.AND[2]).toEqual({ id: { not: 'w1' } });
    });

    it('nada encontrado', async () => {
      await expect(
        service.checkDuplicate({ title: 'x', composerId: 'c1' } as never),
      ).resolves.toEqual({
        found: false,
        work: null,
      });
    });
  });

  it('carregar para edição passa pela checagem de dono', async () => {
    await service.findForEdit('w1', 'u1', false);
    expect(prisma.work.findUnique).toHaveBeenCalledTimes(2);

    await expect(
      service.findForEdit('w1', 'outro', false),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
