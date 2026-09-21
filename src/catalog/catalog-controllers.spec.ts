import { BadRequestException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';
import { ComposerBioService } from './composers/composer-bio.service';
import { ComposersController } from './composers/composers.controller';
import { ComposersService } from './composers/composers.service';
import { DiscoveryController } from './discovery/discovery.controller';
import { DiscoveryService } from './discovery/discovery.service';
import { EpochsController } from './epochs/epochs.controller';
import { EpochsService } from './epochs/epochs.service';
import { InstrumentsController } from './instruments/instruments.controller';
import { InstrumentsService } from './instruments/instruments.service';
import { ImslpScoresService } from './works/imslp-scores.service';
import { WorksController } from './works/works.controller';
import { WorksService } from './works/works.service';

const user = (role: number): AccessTokenPayload => ({
  sub: 'u1',
  email: 'a@x.com',
  role,
  isTeacher: false,
  isStudent: false,
  type: 'access',
});

/** Um objeto cujos métodos devolvem o próprio nome — basta para conferir a delegação. */
function echoMock<T extends string>(...methods: T[]): Record<T, jest.Mock> {
  return Object.fromEntries(
    methods.map((method) => [method, jest.fn().mockResolvedValue(method)]),
  ) as Record<T, jest.Mock>;
}

describe('WorksController', () => {
  const works = echoMock(
    'search',
    'getCatalog',
    'getFilterOptions',
    'getAllGenres',
    'searchGenres',
    'findRelated',
    'getScores',
    'updateMedia',
    'clearMedia',
    'findOne',
  );
  const imslp = echoMock('refresh');
  const controller = new WorksController(
    works as unknown as WorksService,
    imslp as unknown as ImslpScoresService,
  );

  it('leituras públicas repassam ao serviço', async () => {
    await expect(controller.findAll({ q: 'x' })).resolves.toBe('search');
    await expect(controller.findCatalog({})).resolves.toBe('getCatalog');
    await expect(controller.findFilterOptions()).resolves.toBe(
      'getFilterOptions',
    );
    await expect(controller.findAllGenres()).resolves.toBe('getAllGenres');
    await expect(controller.searchGenres({ q: 'so' })).resolves.toBe(
      'searchGenres',
    );
    await expect(controller.getScores('w1', {})).resolves.toBe('getScores');
    await expect(controller.findOne('w1')).resolves.toBe('findOne');
    await expect(controller.refreshScores('w1')).resolves.toBe('refresh');
  });

  it('relacionadas: limite entre 1 e 20, padrão 6', async () => {
    await controller.findRelated('w1');
    await controller.findRelated('w1', '50');
    await controller.findRelated('w1', 'abc');
    await controller.findRelated('w1', '0');

    expect(works.findRelated.mock.calls.map(([, limit]) => limit)).toEqual([
      6, 20, 6, 6,
    ]);
  });

  it('mídia: admin é papel ≥ 1; tipo desconhecido é 400', async () => {
    await controller.updateMedia('w1', user(1), { mediaSource: 'x' });
    expect(works.updateMedia).toHaveBeenCalledWith('w1', 'u1', true, {
      mediaSource: 'x',
    });

    await controller.clearMedia('w1', user(0), 'youtube');
    expect(works.clearMedia).toHaveBeenCalledWith('w1', 'u1', false, 'youtube');

    await expect(
      controller.clearMedia('w1', user(0), 'podcast'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ComposersController', () => {
  const composers = echoMock(
    'findAll',
    'count',
    'findFamous',
    'findRecommended',
    'findFeatured',
    'getWorkTypeCounts',
    'findWorks',
    'getFilterOptions',
    'findOne',
  );
  const bio = { biography: jest.fn() };
  const controller = new ComposersController(
    composers as unknown as ComposersService,
    bio as unknown as ComposerBioService,
  );

  it('leituras repassam ao serviço', async () => {
    await expect(controller.findAll({})).resolves.toBe('findAll');
    await expect(controller.count({})).resolves.toBe('count');
    await expect(controller.findFamous()).resolves.toBe('findFamous');
    await expect(controller.findRecommended()).resolves.toBe('findRecommended');
    await expect(controller.findFeatured()).resolves.toBe('findFeatured');
    await expect(controller.getWorkTypeCounts('c1')).resolves.toBe(
      'getWorkTypeCounts',
    );
    await expect(controller.findWorks('c1', {})).resolves.toBe('findWorks');
    await expect(controller.getFilterOptions('c1')).resolves.toBe(
      'getFilterOptions',
    );
    await expect(controller.findOne('c1')).resolves.toBe('findOne');
  });

  describe('biografia', () => {
    const response = () => ({ status: jest.fn() }) as unknown as Response;

    it('pronta: 200, português por padrão', async () => {
      bio.biography.mockResolvedValue({ biography: 'texto', language: 'pt' });
      const res = response();

      await controller.biography('c1', {}, res);

      expect(bio.biography).toHaveBeenCalledWith('c1', 'pt');
      expect(res.status).not.toHaveBeenCalled();
    });

    it('ainda gerando: 202', async () => {
      bio.biography.mockResolvedValue({
        biography: null,
        status: 'generating',
        language: 'en',
      });
      const res = response();

      await controller.biography('c1', { language: 'en' }, res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
    });

    it('a IA não conhece: 200 com status, sem 202', async () => {
      bio.biography.mockResolvedValue({
        biography: null,
        status: 'unavailable',
        language: 'pt',
      });
      const res = response();

      await controller.biography('c1', {}, res);

      expect(res.status).not.toHaveBeenCalled();
    });
  });
});

describe('EpochsController, InstrumentsController e DiscoveryController', () => {
  it('repassam ao serviço', async () => {
    const epochs = echoMock('findAll', 'getComposersByEpoch', 'getTimeline');
    const instruments = echoMock('findAll', 'getStats');
    const discovery = echoMock('getDiscoveries', 'getRecentAdditions');

    const epochsController = new EpochsController(
      epochs as unknown as EpochsService,
    );
    const instrumentsController = new InstrumentsController(
      instruments as unknown as InstrumentsService,
    );
    const discoveryController = new DiscoveryController(
      discovery as unknown as DiscoveryService,
    );

    await expect(epochsController.findAll()).resolves.toBe('findAll');
    await expect(epochsController.getComposersByEpoch()).resolves.toBe(
      'getComposersByEpoch',
    );
    await expect(epochsController.getTimeline()).resolves.toBe('getTimeline');
    await expect(instrumentsController.findAll()).resolves.toBe('findAll');
    await expect(instrumentsController.getStats('i1')).resolves.toBe(
      'getStats',
    );
    expect(instruments.getStats).toHaveBeenCalledWith('i1');
    await expect(discoveryController.getDiscoveries()).resolves.toBe(
      'getDiscoveries',
    );
    await expect(discoveryController.getRecentAdditions()).resolves.toBe(
      'getRecentAdditions',
    );
  });
});
