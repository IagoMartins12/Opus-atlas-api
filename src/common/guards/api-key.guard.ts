import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/api-key.decorator';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private configService: ConfigService,
    private reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Verifica se a rota é pública
    // const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
    //   context.getHandler(),
    //   context.getClass(),
    // ]);

    // if (isPublic) {
    //   return true;
    // }

    // const request = context.switchToHttp().getRequest();
    // const apiKey = request.headers['x-api-key'];
    // const validApiKey = this.configService.get<string>('API_KEY');

    // if (!apiKey || apiKey !== validApiKey) {
    //   throw new UnauthorizedException('API Key inválida ou ausente');
    // }

    return true;
  }
}
