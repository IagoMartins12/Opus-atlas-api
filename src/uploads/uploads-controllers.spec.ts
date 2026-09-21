import { BadRequestException } from '@nestjs/common';
import { StorageAssetKind } from '@prisma/client';
import type { Request, Response } from 'express';
import { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';
import { policyFor } from '../common/storage/asset-policies';
import { ComposerUploadsController } from './composers/composer-uploads.controller';
import { ComposerUploadsService } from './composers/composer-uploads.service';
import { UploadHistoryController } from './history/upload-history.controller';
import { UploadHistoryQueryService } from './history/upload-history-query.service';
import { ModerationController } from './moderation/moderation.controller';
import { ModerationService } from './moderation/moderation.service';
import { ScoreUploadsController } from './scores/score-uploads.controller';
import { ScoreUploadsService } from './scores/score-uploads.service';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { WorkUploadsController } from './works/work-uploads.controller';
import { WorkUploadsService } from './works/work-uploads.service';

const userWith = (role: number): AccessTokenPayload => ({
  sub: 'u1',
  email: 'a@x.com',
  role,
  isTeacher: false,
  isStudent: false,
  type: 'access',
});
const request = {
  headers: { 'user-agent': 'UA' },
  ip: '1.1.1.1',
} as unknown as Request;

function echoMock<T extends string>(...methods: T[]): Record<T, jest.Mock> {
  return Object.fromEntries(
    methods.map((method) => [method, jest.fn().mockResolvedValue(method)]),
  ) as Record<T, jest.Mock>;
}

describe('UploadsController', () => {
  const service = echoMock(
    'createSignedUpload',
    'confirmUpload',
    'uploadFile',
    'deleteOwnAsset',
  );
  const controller = new UploadsController(
    service as unknown as UploadsService,
  );
  const kind = StorageAssetKind.PROFILE_IMAGE;
  const file = (size = 10) =>
    ({
      buffer: Buffer.from('x'),
      originalname: 'a.jpg',
      size,
    }) as Express.Multer.File;

  it('assinar, confirmar e apagar levam o usuário', async () => {
    await controller.createSignedUpload(userWith(0), {} as never);
    await controller.confirmUpload(userWith(0), 'a1');
    await controller.deleteAsset(userWith(0), 'a1');

    expect(service.createSignedUpload).toHaveBeenCalledWith('u1', {});
    expect(service.confirmUpload).toHaveBeenCalledWith('u1', 'a1');
    expect(service.deleteOwnAsset).toHaveBeenCalledWith('u1', 'a1');
  });

  it('envio direto repassa os bytes', async () => {
    await controller.uploadFile(userWith(0), file(), kind, 'escopo_1');

    expect(service.uploadFile).toHaveBeenCalledWith('u1', kind, 'escopo_1', {
      buffer: Buffer.from('x'),
      originalName: 'a.jpg',
      size: 10,
    });
  });

  it('recusa: sem arquivo, tipo inválido, escopo inválido, acima do teto do tipo', async () => {
    await expect(
      controller.uploadFile(userWith(0), undefined, kind, 's'),
    ).rejects.toThrow('Nenhum arquivo');
    await expect(
      controller.uploadFile(userWith(0), file(), 'EXE', 's'),
    ).rejects.toThrow('Tipo de arquivo inválido');
    await expect(
      controller.uploadFile(userWith(0), file(), kind, '../x'),
    ).rejects.toThrow('scopeId inválido');
    await expect(
      controller.uploadFile(userWith(0), file(), kind, ''),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.uploadFile(
        userWith(0),
        file(policyFor(kind).maxBytes + 1),
        kind,
        's',
      ),
    ).rejects.toThrow('excede o limite');
  });
});

describe.each([
  [
    'compositor',
    ComposerUploadsController,
    [
      'create',
      'checkDuplicate',
      'cascadeInfo',
      'findForEdit',
      'update',
      'remove',
    ],
  ],
  [
    'obra',
    WorkUploadsController,
    [
      'create',
      'checkDuplicate',
      'cascadeInfo',
      'findForEdit',
      'update',
      'remove',
    ],
  ],
])('envio de %s', (_label, Controller, methods) => {
  const service = echoMock(...methods);
  const controller = new (Controller as new (
    s: unknown,
  ) => ComposerUploadsController)(
    service as unknown as ComposerUploadsService & WorkUploadsService,
  );

  it('repassa; admin de envio é o papel 2', async () => {
    await controller.create(userWith(0), {} as never, request);
    await controller.checkDuplicate({} as never);
    await controller.cascadeInfo('x');
    await controller.findForEdit(userWith(2), 'x');
    await controller.update(userWith(1), 'x', {} as never, request);
    await controller.remove(userWith(2), 'x', request);

    expect(service.findForEdit).toHaveBeenCalledWith('x', 'u1', true);
    expect(service.update).toHaveBeenCalledWith(
      'u1',
      false,
      'x',
      {},
      expect.any(Object),
    );
    expect(service.remove).toHaveBeenCalledWith(
      'u1',
      true,
      'x',
      expect.any(Object),
    );
  });
});

describe('ScoreUploadsController', () => {
  const service = echoMock(
    'create',
    'groups',
    'findForEdit',
    'update',
    'remove',
  );
  const controller = new ScoreUploadsController(
    service as unknown as ScoreUploadsService,
  );

  it('repassa', async () => {
    await controller.create(userWith(0), {} as never, request);
    await controller.groups(userWith(0), 'w1');
    await controller.findForEdit(userWith(0), 's1');
    await controller.update(userWith(2), 's1', {} as never, request);
    await controller.remove(userWith(0), 's1', request);

    expect(service.groups).toHaveBeenCalledWith('w1', 'u1');
    expect(service.findForEdit).toHaveBeenCalledWith('s1', 'u1', false);
    expect(service.update).toHaveBeenCalledWith(
      'u1',
      true,
      's1',
      {},
      expect.any(Object),
    );
  });
});

describe('UploadHistoryController', () => {
  const service = echoMock('list', 'recent', 'stats', 'contributionTotals');
  const exportMock = jest.fn();
  const controller = new UploadHistoryController({
    ...service,
    export: exportMock,
  } as unknown as UploadHistoryQueryService);

  it('lista, recentes, estatísticas e totais', async () => {
    await controller.list(userWith(2), {} as never);
    expect(service.list).toHaveBeenCalledWith('u1', true, {});

    await controller.recent(userWith(0));
    await controller.recent(userWith(0), '3');
    expect(service.recent.mock.calls).toEqual([
      ['u1', 10],
      ['u1', 3],
    ]);

    await controller.stats(userWith(0));
    await controller.contributionTotals(userWith(0));
  });

  it('exportação em JSON volta como está; em CSV vai com BOM e cabeçalhos', async () => {
    const response = { setHeader: jest.fn() } as unknown as Response;

    exportMock.mockResolvedValue({ items: [] });
    await expect(
      controller.export(userWith(0), {} as never, response),
    ).resolves.toEqual({ items: [] });
    expect(exportMock).toHaveBeenLastCalledWith('u1', false, {}, 'json');

    exportMock.mockResolvedValue({ csv: 'a,b' });
    await expect(
      controller.export(userWith(0), { format: 'csv' } as never, response),
    ).resolves.toBe('﻿a,b');
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/csv; charset=utf-8',
    );
  });
});

describe('ModerationController', () => {
  const service = echoMock('report', 'list', 'stats', 'resolve', 'resolveMany');
  const controller = new ModerationController(
    service as unknown as ModerationService,
  );

  it('repassa denúncia, fila, estatísticas e decisões', async () => {
    await controller.report(userWith(0), {} as never, request);
    await controller.list({} as never);
    await controller.stats({ days: 30 } as never);
    await controller.resolve(userWith(1), 'm1', {} as never);
    await controller.resolveMany(userWith(1), {
      moderationIds: ['m1', 'm2'],
    } as never);

    expect(service.stats).toHaveBeenCalledWith(30);
    expect(service.resolve).toHaveBeenCalledWith('u1', 'm1', {});
    expect(service.resolveMany).toHaveBeenCalledWith('u1', ['m1', 'm2'], {
      moderationIds: ['m1', 'm2'],
    });
  });
});
