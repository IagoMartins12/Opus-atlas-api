import { AchievementsController } from './achievements.controller';
import { AchievementsService } from './achievements.service';

describe('AchievementsController', () => {
  const user = { sub: 'u1' } as never;
  const service = {
    listForUser: jest.fn().mockResolvedValue('lista'),
    evaluate: jest.fn().mockResolvedValue([{ xpReward: 10 }, { xpReward: 25 }]),
    progressForUser: jest.fn().mockResolvedValue('progresso'),
    statsForUser: jest.fn().mockResolvedValue('estatísticas'),
    catalog: jest.fn().mockReturnValue('catálogo'),
    markAsViewed: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new AchievementsController(
    service as unknown as AchievementsService,
  );

  it('verificação soma o XP das conquistas novas', async () => {
    await expect(controller.check(user)).resolves.toEqual({
      unlocked: [{ xpReward: 10 }, { xpReward: 25 }],
      count: 2,
      xpGained: 35,
    });
  });

  it('as demais rotas repassam ao serviço', async () => {
    await expect(controller.list(user)).resolves.toBe('lista');
    await expect(controller.progress(user)).resolves.toBe('progresso');
    await expect(controller.stats(user)).resolves.toBe('estatísticas');
    expect(controller.catalog()).toBe('catálogo');
    await controller.markAsViewed(user, 'b1');
    expect(service.markAsViewed).toHaveBeenCalledWith('u1', 'b1');
  });
});
