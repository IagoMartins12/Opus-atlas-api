import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';

/**
 * Adaptador do socket.io com a mesma allowlist de origem do HTTP.
 *
 * **Existe porque opção de decorator não enxerga configuração.**
 * `@WebSocketGateway({ cors })` é avaliado quando o módulo é importado, antes
 * de o `ConfigService` existir — a allowlist ali seria fixa no código, ou
 * `process.env` lido cru, escapando da validação do boot. O adaptador é
 * construído em `main.ts`, com a configuração já pronta, e aplica ao socket a
 * mesma lista que o `enableCors` aplica às rotas.
 *
 * A restrição de origem no socket.io vale principalmente para o transporte de
 * long-polling, que é uma requisição HTTP comum e obedece a CORS. O upgrade
 * WebSocket não obedece — navegador nenhum aplica CORS a ele —, e é por isso
 * que o `JobsGateway` confere `Origin` por conta própria no handshake.
 */
export class JobsIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly allowedOrigins: string[],
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.allowedOrigins,
        credentials: true,
      },
    });
  }
}
