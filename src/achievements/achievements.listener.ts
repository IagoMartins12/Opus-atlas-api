import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ACTIVITY_TRACKED,
  ActivityTrackedEvent,
} from '../common/events/activity.events';
import { errorMessage } from '../common/utils/error.util';
import { AchievementsService } from './achievements.service';

/**
 * Janela em que uma nova atividade do mesmo usuário não dispara outra
 * avaliação. Favoritar dez obras seguidas gera uma avaliação, não dez.
 */
const COOLDOWN_MS = 30_000;

@Injectable()
export class AchievementsListener {
  private readonly logger = new Logger(AchievementsListener.name);
  /** Usuários com uma reavaliação agendada para o fim do cooldown. */
  private readonly trailing = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly achievements: AchievementsService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /**
   * Reavalia as conquistas depois de uma atividade relevante.
   *
   * Roda fora do ciclo da requisição: o usuário não espera pela avaliação, e
   * uma falha aqui nunca desfaz a ação que ele acabou de completar. Por isso
   * o handler engole o erro em vez de propagá-lo — com log, para a falha ser
   * visível no monitoramento.
   *
   * O cooldown é compartilhado via Redis, então vale para o cluster inteiro e
   * não por instância.
   */
  @OnEvent(ACTIVITY_TRACKED, { async: true })
  async onActivity(event: ActivityTrackedEvent): Promise<void> {
    const cooldownKey = `achievements:cooldown:${event.userId}`;

    try {
      const recentlyEvaluated = await this.cache.get<boolean>(cooldownKey);

      if (recentlyEvaluated) {
        // A atividade desta janela não pode se perder: a conquista que ela
        // completa só apareceria na próxima ação. Uma reavaliação por usuário
        // fica agendada para depois do cooldown.
        this.scheduleTrailing(event);
        return;
      }

      await this.evaluateAndLog(event);
    } catch (error: unknown) {
      this.logger.error(
        `Falha ao avaliar conquistas de ${event.userId} após ${event.action}: ${errorMessage(error)}`,
      );
    }
  }

  private scheduleTrailing(event: ActivityTrackedEvent): void {
    if (this.trailing.has(event.userId)) return;

    const timer = setTimeout(() => {
      this.trailing.delete(event.userId);
      void this.onActivity(event);
    }, COOLDOWN_MS + 1_000);
    timer.unref();
    this.trailing.set(event.userId, timer);
  }

  private async evaluateAndLog(event: ActivityTrackedEvent): Promise<void> {
    await this.cache.set(
      `achievements:cooldown:${event.userId}`,
      true,
      COOLDOWN_MS,
    );

    const granted = await this.achievements.evaluate(event.userId);

    if (granted.length > 0) {
      this.logger.log(
        `${granted.length} conquista(s) desbloqueada(s) para ${event.userId} ` +
          `após ${event.action}: ${granted.map((badge) => badge.badgeId).join(', ')}`,
      );
    }
  }
}
