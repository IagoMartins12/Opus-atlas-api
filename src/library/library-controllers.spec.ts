import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ScoreSource } from '@prisma/client';
import { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';
import { AnnotationsController } from './annotations/annotations.controller';
import { AnnotationsService } from './annotations/annotations.service';
import { ComposerFavoritesController } from './favorites/composer-favorites.controller';
import { FavoritesService } from './favorites/favorites.service';
import { ScoreFavoritesController } from './favorites/score-favorites.controller';
import { WorkFavoritesController } from './favorites/work-favorites.controller';
import { LearnedController } from './learning/learned.controller';
import { LearningService } from './learning/learning.service';
import { WantToLearnController } from './learning/want-to-learn.controller';

const user: AccessTokenPayload = {
  sub: 'u1',
  email: 'a@x.com',
  role: 0,
  isTeacher: false,
  isStudent: false,
  type: 'access',
};

function echoMock<T extends string>(...methods: T[]): Record<T, jest.Mock> {
  return Object.fromEntries(
    methods.map((method) => [method, jest.fn().mockResolvedValue(method)]),
  ) as Record<T, jest.Mock>;
}

describe('AnnotationsController', () => {
  const service = echoMock(
    'findAll',
    'create',
    'findOne',
    'update',
    'remove',
    'vote',
  );
  const controller = new AnnotationsController(
    service as unknown as AnnotationsService,
  );

  it('leitura pública passa o usuário quando há', async () => {
    await controller.findAll(undefined, {} as never);
    expect(service.findAll).toHaveBeenLastCalledWith({}, undefined);

    await controller.findOne(user, 'a1');
    expect(service.findOne).toHaveBeenLastCalledWith('a1', 'u1');
  });

  it('escrita e voto levam o usuário do token', async () => {
    await controller.create(user, {} as never);
    await controller.update(user, 'a1', {} as never);
    await controller.remove(user, 'a1');
    await controller.vote(user, 'a1', { isHelpful: true } as never);

    expect(service.create).toHaveBeenCalledWith('u1', {});
    expect(service.update).toHaveBeenCalledWith('a1', 'u1', {});
    expect(service.remove).toHaveBeenCalledWith('a1', 'u1');
    expect(service.vote).toHaveBeenCalledWith('a1', 'u1', true);
  });
});

describe('favoritos', () => {
  const service = echoMock(
    'getWorkScoreStats',
    'getMostFavoritedScore',
    'getScoreFavoriteStatus',
    'listScoreFavorites',
    'toggleScoreFavorite',
    'getComposerFavoriteStatus',
    'listComposerFavorites',
    'toggleComposerFavorite',
    'getWorkFavoriteStatus',
    'listWorkFavorites',
    'toggleWorkFavorite',
  );
  const favorites = service as unknown as FavoritesService;

  describe('partituras', () => {
    const controller = new ScoreFavoritesController(favorites);

    it('estatísticas são públicas, mas exigem a obra', async () => {
      await expect(
        controller.find(
          undefined,
          'w1',
          undefined,
          ScoreSource.IMSLP,
          'work-stats',
        ),
      ).resolves.toBe('getWorkScoreStats');
      await expect(
        controller.find(
          undefined,
          'w1',
          undefined,
          ScoreSource.IMSLP,
          'most-favorited',
        ),
      ).resolves.toBe('getMostFavoritedScore');
      await expect(
        controller.find(
          undefined,
          undefined,
          undefined,
          ScoreSource.IMSLP,
          'work-stats',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('o resto exige login', async () => {
      await expect(controller.find(undefined, 'w1')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('conferir favorito exige obra e partitura', async () => {
      await expect(
        controller.find(user, 'w1', 's1', ScoreSource.IMSLP, 'check-favorite'),
      ).resolves.toBe('getScoreFavoriteStatus');
      expect(service.getScoreFavoriteStatus).toHaveBeenCalledWith(
        'u1',
        'w1',
        's1',
        ScoreSource.IMSLP,
      );

      await expect(
        controller.find(
          user,
          'w1',
          undefined,
          ScoreSource.IMSLP,
          'check-favorite',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lista do usuário e alternar', async () => {
      await expect(controller.find(user, 'w1')).resolves.toBe(
        'listScoreFavorites',
      );
      await expect(controller.toggle(user, {} as never)).resolves.toBe(
        'toggleScoreFavorite',
      );
    });
  });

  it('compositores: com id é o estado, sem id é a lista', async () => {
    const controller = new ComposerFavoritesController(favorites);

    await expect(controller.find(user, 'c1')).resolves.toBe(
      'getComposerFavoriteStatus',
    );
    await expect(controller.find(user)).resolves.toBe('listComposerFavorites');
    await expect(controller.toggle(user, {} as never)).resolves.toBe(
      'toggleComposerFavorite',
    );
  });

  it('obras: com id é o estado, sem id é a lista', async () => {
    const controller = new WorkFavoritesController(favorites);

    await expect(controller.find(user, 'w1')).resolves.toBe(
      'getWorkFavoriteStatus',
    );
    await expect(controller.find(user)).resolves.toBe('listWorkFavorites');
    await expect(controller.toggle(user, {} as never)).resolves.toBe(
      'toggleWorkFavorite',
    );
  });
});

describe('aprendizado', () => {
  const service = echoMock(
    'getLearned',
    'addOrRemoveLearned',
    'updateLearned',
    'getWantToLearn',
    'addOrRemoveWantToLearn',
    'updateWantToLearn',
  );
  const learning = service as unknown as LearningService;

  it('aprendidas', async () => {
    const controller = new LearnedController(learning);

    await expect(controller.find(user, 'w1')).resolves.toBe('getLearned');
    await expect(controller.addOrRemove(user, {} as never)).resolves.toBe(
      'addOrRemoveLearned',
    );
    await expect(controller.update(user, {} as never)).resolves.toBe(
      'updateLearned',
    );
    expect(service.getLearned).toHaveBeenCalledWith('u1', 'w1');
  });

  it('quero aprender', async () => {
    const controller = new WantToLearnController(learning);

    await expect(controller.find(user)).resolves.toBe('getWantToLearn');
    await expect(controller.addOrRemove(user, {} as never)).resolves.toBe(
      'addOrRemoveWantToLearn',
    );
    await expect(controller.update(user, {} as never)).resolves.toBe(
      'updateWantToLearn',
    );
  });
});
