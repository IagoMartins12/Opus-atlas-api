import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import * as compression from 'compression';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { PaginatedResponseDto } from './common/dto/paginated-response.dto';
import { JobsIoAdapter } from './common/queue/jobs-io.adapter';

async function bootstrap() {
  // `rawBody: true` mantém o corpo cru (`req.rawBody`) disponível em toda
  // requisição, sem desabilitar o parsing JSON automático nas demais rotas —
  // necessário só para `POST /webhook/stripe`, que precisa validar a
  // assinatura do Stripe contra os bytes exatos do payload.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  // Logging estruturado (Pino) — substitui o logger padrão do Nest.
  // Todo log da aplicação passa a sair em JSON, pronto para agregadores (Loki/Datadog).
  app.useLogger(app.get(Logger));

  const configService = app.get(ConfigService);

  // Confia no proxy reverso (Nginx/Cloudflare/ALB) para resolver o IP real do
  // cliente. Sem isso `req.ip` é sempre o IP do proxy e o rate limit por IP
  // vira um balde único para toda a plataforma.
  app.set('trust proxy', configService.get<number>('app.trustProxy', 1));

  // Segurança de headers HTTP (CSP, HSTS, X-Frame-Options, etc.) — seção 3.8/5 do SPEC.md
  app.use(
    helmet({
      // HSTS com preload: força HTTPS inclusive na primeira visita.
      hsts: {
        maxAge: 31_536_000,
        includeSubDomains: true,
        preload: true,
      },
      // A API só devolve JSON; nada aqui carrega script ou é embutido em frame.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  // Compressão gzip/brotli — reduz payload de resposta (seção 3.7 do SPEC.md)
  app.use(compression());

  // Necessário para ler o refresh token do cookie `httpOnly` (seção 3.3).
  app.use(cookieParser());

  // CORS restrito por allowlist explícita (nunca origin: '*' com credentials)
  const allowedOrigins = configService.get<string[]>('cors.allowedOrigins', [
    'http://localhost:3000',
  ]);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
  });

  // Progresso de job em tempo real, no namespace `/jobs`. O adaptador é
  // montado aqui, e não nas opções do `@WebSocketGateway`, porque aquelas são
  // avaliadas na importação do módulo — antes de a configuração existir. Assim
  // o socket herda exatamente a mesma allowlist de origem das rotas HTTP, em
  // vez de manter uma segunda lista que envelhece sozinha.
  app.useWebSocketAdapter(new JobsIoAdapter(app, allowedOrigins));

  // Validação global estrita: remove campos não declarados, rejeita campos extras,
  // aplica transformação automática de tipos (seção 3.5 do SPEC.md)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Serializa DTOs de resposta respeitando @Exclude()/@Expose() — nunca vaza campo sensível
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // Os filtros de exceção NÃO são registrados aqui.
  //
  // `useGlobalFilters` acrescenta ao fim da lista de filtros globais, e o Nest
  // percorre essa lista invertida escolhendo o primeiro que casa com a exceção.
  // Como `AllExceptionsFilter` usa `@Catch()` sem argumento (casa com tudo),
  // registrá-lo aqui o colocava sempre à frente do `PrismaExceptionFilter` —
  // que nunca chegava a rodar, fazendo violação de unique voltar 500 em vez de
  // 409 e "não encontrado" voltar 500 em vez de 404.
  //
  // Ambos agora são declarados como `APP_FILTER` no `AppModule`, na ordem que
  // faz o filtro específico do Prisma ser consultado primeiro.

  // Prefixo global para todas as rotas
  app.setGlobalPrefix('api');

  // Documentação Swagger/OpenAPI — obrigatória para todo endpoint (seção 3.4 do SPEC.md).
  // Desligada em produção por padrão: o `SwaggerModule` registra a rota direto
  // no adaptador HTTP, fora do pipeline de guards, então o `JwtAuthGuard` global
  // não a protege e o contrato inteiro ficaria público.
  if (configService.get<boolean>('docs.enabled', true)) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Opus Atlas API')
      .setDescription(
        'API oficial da plataforma Opus Atlas — catálogo, blog, portal de estudos e administração.',
      )
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'access-token',
      )
      .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
      .addTag('health', 'Verificação de saúde da aplicação')
      .addTag('auth', 'Autenticação e emissão de tokens JWT')
      .addTag('profile', 'Perfil, conta e preferências do usuário logado')
      .addTag('catalog-works', 'Obras musicais')
      .addTag('catalog-composers', 'Compositores')
      .addTag('catalog-instruments', 'Instrumentos')
      .addTag(
        'catalog-discovery',
        'Descoberta e destaques do catálogo (home): compositor do dia, aleatórios e recentes',
      )
      .addTag('media-search', 'Busca automática e enriquecimento de mídia')
      .addTag(
        'library-favorites',
        'Favoritos do usuário (compositores, obras, partituras)',
      )
      .addTag(
        'library-learning',
        'Obras aprendidas e lista de estudo do usuário',
      )
      .addTag('library-annotations', 'Anotações de usuários sobre obras')
      .addTag('blog-articles', 'Artigos do blog')
      .addTag('blog-categories', 'Categorias do blog')
      .addTag('blog-tags', 'Tags do blog')
      .addTag('blog-search', 'Busca e autocomplete no blog')
      .addTag(
        'public-teachers',
        'Diretório público de professores ("Conheça nossos professores")',
      )
      .addTag('newsletter', 'Inscrição pública na newsletter (double opt-in)')
      .addTag('contact', 'Formulário de contato público')
      .addTag('billing', 'Preços, cupons e assinatura do usuário')
      .addTag('billing-webhook', 'Webhook do Stripe')
      .addTag('billing-cron', 'Job de manutenção diária de assinaturas')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig, {
      extraModels: [PaginatedResponseDto],
    });

    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha' },
    });
  }

  // Graceful shutdown — permite ao orquestrador (K8s/Docker) drenar conexões
  // antes de encerrar o processo, evitando requests cortadas no meio.
  app.enableShutdownHooks();

  const port = configService.get<number>('app.port', 4000);
  await app.listen(port);

  const logger = app.get(Logger);
  logger.log(`Opus Atlas API rodando em http://localhost:${port}/api`);

  if (configService.get<boolean>('docs.enabled', true)) {
    logger.log(`Documentação Swagger: http://localhost:${port}/api/docs`);
  }
}

void bootstrap();
