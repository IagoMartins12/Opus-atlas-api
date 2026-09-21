import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ACTIVITY_TRACKED,
  ActivityDomain,
  ActivityTrackedEvent,
} from './activity.events';

/**
 * Publica atividades do usuário no barramento interno.
 *
 * Serviços de domínio dependem desta classe, não do `EventEmitter2` cru: o
 * ponto de emissão fica com um nome de método legível (`track`) e o formato do
 * evento passa a ser tipado num só lugar.
 *
 * Emitir nunca bloqueia nem falha a ação de origem — favoritar uma obra não
 * pode dar erro porque a avaliação de conquistas quebrou.
 */
@Injectable()
export class ActivityTracker {
  constructor(private readonly events: EventEmitter2) {}

  track(userId: string, domain: ActivityDomain, action: string): void {
    this.events.emit(
      ACTIVITY_TRACKED,
      new ActivityTrackedEvent(userId, domain, action),
    );
  }
}
