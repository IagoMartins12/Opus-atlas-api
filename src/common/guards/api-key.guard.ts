import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Protege rotas server-to-server (cron, webhooks, scrapers) com uma chave
 * estática enviada no header `x-api-key`. Usado explicitamente por controller/rota
 * via `@UseGuards(ApiKeyGuard)` — não é global (rotas de usuário usam `JwtAuthGuard`).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const validApiKey = this.configService.get<string>('security.apiKey');

    if (!validApiKey) {
      throw new UnauthorizedException(
        'API Key não configurada no servidor (security.apiKey ausente)',
      );
    }

    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];

    if (!apiKey || apiKey !== validApiKey) {
      throw new UnauthorizedException('API Key inválida ou ausente');
    }

    return true;
  }
}
