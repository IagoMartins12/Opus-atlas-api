import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test, TestingModule } from '@nestjs/testing';
import { ActivityTrackedEvent } from '../common/events/activity.events';
import { AchievementsListener } from './achievements.listener';
import { AchievementsService } from './achievements.service';

describe('AchievementsListener', () => {
  let listener: AchievementsListener;
  let achievements: { evaluate: jest.Mock };
  let cache: { get: jest.Mock; set: jest.Mock };

  const event = new ActivityTrackedEvent(
    'user-1',
    'favorites',
    'favorite.work.added',
  );

  beforeEach(async () => {
    achievements = { evaluate: jest.fn().mockResolvedValue([]) };
    cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AchievementsListener,
        { provide: AchievementsService, useValue: achievements },
        { provide: CACHE_MANAGER, useValue: cache },
      ],
    }).compile();

    listener = module.get(AchievementsListener);
  });

  it('avalia as conquistas ao receber uma atividade', async () => {
    await listener.onActivity(event);

    expect(achievements.evaluate).toHaveBeenCalledWith('user-1');
  });

  // Favoritar dez obras seguidas gera uma avaliação, não dez.
  it('não reavalia dentro da janela de espera', async () => {
    cache.get.mockResolvedValue(true);

    await listener.onActivity(event);

    expect(achievements.evaluate).not.toHaveBeenCalled();
  });

  it('grava a espera antes de avaliar', async () => {
    await listener.onActivity(event);

    const setOrder = cache.set.mock.invocationCallOrder[0];
    const evaluateOrder = achievements.evaluate.mock.invocationCallOrder[0];

    expect(setOrder).toBeLessThan(evaluateOrder);
  });

  it('usa uma chave de espera por usuário', async () => {
    await listener.onActivity(event);

    expect(cache.set).toHaveBeenCalledWith(
      'achievements:cooldown:user-1',
      true,
      expect.any(Number),
    );
  });

  // A ação do usuário já aconteceu; uma falha na avaliação não pode desfazê-la
  // nem propagar erro para quem favoritou.
  it('engole erro da avaliação', async () => {
    achievements.evaluate.mockRejectedValue(new Error('banco fora'));

    await expect(listener.onActivity(event)).resolves.toBeUndefined();
  });

  it('engole erro do cache e não deixa a ação falhar', async () => {
    cache.get.mockRejectedValue(new Error('redis fora'));

    await expect(listener.onActivity(event)).resolves.toBeUndefined();
  });
});
