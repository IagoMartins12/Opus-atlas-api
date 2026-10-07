import { SchedulesKeeper } from './schedules-keeper';

describe('SchedulesKeeper', () => {
  it('reaplica o que está no banco e agenda as limpezas que nunca existiram', async () => {
    const queue = {
      reaplicarAgendamentos: jest.fn().mockResolvedValue(2),
      agendarSeNuncaExistiu: jest.fn().mockResolvedValue(true),
    };

    await new SchedulesKeeper(queue as never).onApplicationBootstrap();

    expect(queue.reaplicarAgendamentos).toHaveBeenCalled();
    const ids = queue.agendarSeNuncaExistiu.mock.calls.map(
      ([a]) => a.schedulerId,
    );
    expect(ids).toEqual([
      'maintenance:tokens.prune',
      'maintenance:notifications.prune',
      'maintenance:audit.prune',
    ]);
    // Agendada aplica: a limpeza não pode rodar em simulação para sempre.
    expect(queue.agendarSeNuncaExistiu.mock.calls[0][0].payload).toMatchObject({
      taskId: 'tokens.prune',
      dryRun: false,
      retentionDays: 30,
    });
  });

  it('erro no banco não derruba o worker', async () => {
    const queue = {
      reaplicarAgendamentos: jest.fn().mockRejectedValue(new Error('mongo')),
      agendarSeNuncaExistiu: jest.fn(),
    };

    await expect(
      new SchedulesKeeper(queue as never).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
  });
});
