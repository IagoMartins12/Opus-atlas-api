import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerStorage } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './prisma/prisma.module';
import { ScrapersModule } from './scrapers/scrapers.module';
import { HealthModule } from './health/health.module';
import { CatalogModule } from './catalog/catalog.module';
import { MediaSearchModule } from './media-search/media-search.module';
import { AuthModule } from './auth/auth.module';
import { MailModule } from './mail/mail.module';
import { LibraryModule } from './library/library.module';
import { BlogModule } from './blog/blog.module';
import { ProfileModule } from './profile/profile.module';
import { PublicTeachersModule } from './public-teachers/public-teachers.module';
import { ContactModule } from './contact/contact.module';
import { NewsletterModule } from './newsletter/newsletter.module';
import { BillingModule } from './billing/billing.module';
import { UploadsModule } from './uploads/uploads.module';
import { AchievementsModule } from './achievements/achievements.module';
import { AdminModule } from './admin/admin.module';
import { PortalModule } from './portal/portal.module';
import { AppEventsModule } from './common/events/events.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { appConfiguration } from './config/configuration';
import { validateEnv } from './config/env.validation';
import { envFilePath } from './config/env-files';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { ObservabilityModule } from './common/observability/observability.module';
import { AuditModule } from './common/audit/audit.module';
import { AppCacheModule } from './common/cache/cache.module';
import { QueueModule } from './common/queue/queue.module';
import { runsWorkers } from './common/queue/queue-role';
import { WorkerModule } from './workers/worker.module';
import { SearchModule } from './common/search/search.module';
import { StorageModule } from './common/storage/storage.module';
import { RevalidationModule } from './revalidation/revalidation.module';
import { SeoModule } from './seo/seo.module';
import { AdsModule } from './ads/ads.module';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { PublicCacheInterceptor } from './common/interceptors/public-cache.interceptor';
import { AppThrottlerGuard } from './common/throttler/app-throttler.guard';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler.storage';
import { OriginGuard } from './common/guards/origin.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // `.env.local`, `.env.hml` ou `.env.prd`, conforme `APP_ENV` — ver env-files.ts.
      envFilePath: envFilePath(),
      load: [appConfiguration],
      validate: validateEnv,
    }),

    // Cache distribuído em Redis — compartilhado por todas as instâncias da API
    // (substitui o cache em memória; seção 3.7/12.1 do SPEC.md)
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        store: await redisStore({
          url: configService.get<string>('redis.url'),
        }),
        ttl: 0,
      }),
    }),

    // Logging estruturado (Pino) — 100% das requisições logadas em JSON,
    // com requestId correlacionado (seção 3.9.1 do SPEC.md)
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        pinoHttp: {
          level: configService.get<string>('logging.level', 'info'),
          genReqId: (req) =>
            (req.headers['x-request-id'] as string) ?? undefined,
          transport: configService.get<boolean>('logging.pretty', true)
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-api-key"]',
              'res.headers["set-cookie"]',
              'req.body.password',
              'req.body.currentPassword',
              'req.body.newPassword',
              'req.body.token',
              'req.body.refreshToken',
              'req.body.accessToken',
              'req.body.cardNumber',
              'req.body.cvv',
            ],
            remove: true,
          },
          customProps: (req) => ({ requestId: req.headers['x-request-id'] }),
        },
      }),
    }),

    // Rate limiting global — mitigação de abuso (seção 3.7/3.8 do SPEC.md).
    // O storage é o Redis (ver `RedisThrottlerStorage`): com o storage padrão
    // em memória, cada réplica conta separado e o limite efetivo vira
    // `réplicas × limite`, ou seja, some justamente ao escalar horizontalmente.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            ttl: configService.get<number>('throttle.ttlMs', 60000),
            limit: configService.get<number>('throttle.limit', 100),
          },
        ],
      }),
    }),

    // Barramento de eventos interno. Desacopla quem faz a ação de quem reage
    // a ela — é o que permite as conquistas serem avaliadas sem que o módulo
    // de favoritos, o de aprendizado e o de anotações conheçam as conquistas.
    EventEmitterModule.forRoot(),
    RevalidationModule,
    SeoModule,
    AdsModule,

    PrismaModule,
    ObservabilityModule,
    AuditModule,
    AppCacheModule,
    SearchModule,
    AppEventsModule,
    StorageModule,

    // Fila (Etapa 1.6). O lado produtor entra em todo processo — enfileirar é
    // barato e a API precisa disso.
    QueueModule,

    ScrapersModule,
    HealthModule,
    CatalogModule,
    MediaSearchModule,
    MailModule,
    AuthModule,
    ProfileModule,
    LibraryModule,
    BlogModule,
    PublicTeachersModule,
    NewsletterModule,
    ContactModule,
    BillingModule,
    UploadsModule,
    AchievementsModule,
    PortalModule,
    AdminModule,

    /**
     * Os consumidores só entram quando `QUEUE_ROLE` inclui `worker`.
     *
     * Um `@Processor` registrado abre um worker BullMQ, e worker aberto
     * consome job: sem esta condição, toda réplica da API processaria trabalho
     * pesado no mesmo processo que atende requisição HTTP. O padrão é `all`,
     * para que uma instalação de um contêiner só continue funcionando sem
     * configurar nada.
     */
    ...(runsWorkers() ? [WorkerModule] : []),
  ],
  providers: [
    // Rate limit compartilhado entre instâncias.
    { provide: ThrottlerStorage, useClass: RedisThrottlerStorage },

    // --- Guards globais, em ordem de execução ---
    // 1. Rate limit primeiro: abuso é barrado antes de gastar validação de token.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    // 2. Autenticação JWT — toda rota exige token, exceto `@Public()`.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // 3. Autorização por papel — só age quando a rota usa `@Roles(...)`.
    { provide: APP_GUARD, useClass: RolesGuard },
    // 4. Anti-CSRF para mutações baseadas em cookie. Depois do JWT porque
    //    requisição com Bearer é isenta, e isso só se sabe após autenticar.
    { provide: APP_GUARD, useClass: OriginGuard },

    // --- Filtros de exceção ---
    // A ORDEM IMPORTA. O Nest inverte a lista de filtros globais e usa o
    // primeiro cujo `@Catch()` case com a exceção. `AllExceptionsFilter` usa
    // `@Catch()` sem argumento e casa com tudo, então precisa ser declarado
    // ANTES do filtro do Prisma — assim, depois da inversão, o filtro
    // específico do Prisma é consultado primeiro e consegue traduzir P2002
    // em 409 e P2025 em 404 antes do genérico assumir.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },

    // --- Interceptors globais ---
    // Timeout antes de tudo, para que uma rota travada não segure a conexão.
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
    // Log estruturado + métricas Prometheus de toda requisição.
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    // Trilha de auditoria das rotas anotadas com `@Audited()`.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    // `Cache-Control` das rotas anotadas com `@PublicCache()` — deixa CDN e
    // proxy reverso absorverem o tráfego anônimo do catálogo.
    { provide: APP_INTERCEPTOR, useClass: PublicCacheInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Gera/propaga X-Request-Id antes de qualquer outro middleware/guard
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
