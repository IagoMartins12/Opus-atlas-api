import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthCookieService } from './auth-cookie.service';
import { AuthService } from './auth.service';
import { GoogleAuthController } from './google/google-auth.controller';
import { GoogleAuthService } from './google/google-auth.service';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { UserTokenService } from './user-token.service';

/**
 * Global para que `JwtAuthGuard`/`RolesGuard` (registrados como `APP_GUARD`
 * em `AppModule`) e o decorator `@CurrentUser()` fiquem disponíveis em
 * qualquer módulo de domínio sem precisar reimportar `AuthModule` (seção 3.1 do SPEC.md).
 */
@Global()
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('auth.accessSecret'),
        signOptions: {
          // `expiresIn` do jsonwebtoken é um template-literal type (`'15m'`,
          // `'7d'`, ...). Ler a env como esse tipo evita o `as any` e mantém
          // o valor validado pelo schema Joi no boot.
          expiresIn: configService.get<JwtSignOptions['expiresIn']>(
            'auth.accessExpiresIn',
            '15m',
          ),
        },
      }),
    }),
  ],
  controllers: [AuthController, GoogleAuthController],
  providers: [
    AuthService,
    AuthCookieService,
    GoogleAuthService,
    JwtAccessStrategy,
    UserTokenService,
  ],
  // `JwtModule` é reexportado para que o `JobsGateway` possa verificar o token
  // do handshake do WebSocket. Ali não há requisição HTTP, então o `APP_GUARD`
  // global não roda e o passport não é acionado: quem valida a credencial é o
  // próprio gateway, e para isso precisa do `JwtService`.
  exports: [AuthService, AuthCookieService, UserTokenService, JwtModule],
})
export class AuthModule {}
