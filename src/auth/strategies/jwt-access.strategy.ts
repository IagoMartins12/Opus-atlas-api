import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ACCESS_TOKEN_COOKIE } from '../auth-cookie.service';
import { AccessTokenPayload } from '../interfaces/jwt-payload.interface';

/** Token do cookie `httpOnly` — o caminho do navegador. */
export function accessTokenFromCookie(
  request: Request | undefined,
): string | null {
  const cookies = (
    request as (Request & { cookies?: Record<string, string> }) | undefined
  )?.cookies;
  const token = cookies?.[ACCESS_TOKEN_COOKIE];

  return typeof token === 'string' && token.length > 0 ? token : null;
}

/**
 * Cabeçalho primeiro, cookie depois.
 *
 * Quem manda os dois — o servidor do Next repassando a sessão, por exemplo —
 * escolheu o cabeçalho. E requisição com `Bearer` fica isenta do `OriginGuard`,
 * porque um site de terceiros não consegue fazer o navegador anexá-lo.
 */
export const extractAccessToken = ExtractJwt.fromExtractors([
  ExtractJwt.fromAuthHeaderAsBearerToken(),
  accessTokenFromCookie,
]);

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: extractAccessToken,
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('auth.accessSecret')!,
    });
  }

  validate(payload: AccessTokenPayload): AccessTokenPayload {
    return payload;
  }
}
