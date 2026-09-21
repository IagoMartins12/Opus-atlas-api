export const appConfiguration = () => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 4000),
    /**
     * Número de proxies confiáveis à frente da API (Nginx, Cloudflare, ALB).
     * Sem isso o Express usa o IP do proxy como `req.ip`, e o rate limit por IP
     * vira um balde único compartilhado por todos os usuários.
     */
    trustProxy: Number(process.env.TRUST_PROXY_HOPS ?? 1),
  },
  cors: {
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  },
  throttle: {
    ttlMs: Number(process.env.THROTTLE_TTL ?? 60) * 1000,
    limit: Number(process.env.THROTTLE_LIMIT ?? 100),
  },
  logging: {
    level: process.env.LOG_LEVEL ?? 'info',
    pretty: (process.env.NODE_ENV ?? 'development') !== 'production',
  },
  observability: {
    sentryDsn: process.env.SENTRY_DSN,
    /** Versão/commit do deploy, para correlacionar regressão a release. */
    release: process.env.SENTRY_RELEASE ?? process.env.GIT_COMMIT_SHA,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  },
  docs: {
    /**
     * O Swagger é registrado fora do pipeline de guards do Nest, então o
     * `JwtAuthGuard` global não o protege. Em produção ele fica desligado por
     * padrão — publicar o contrato inteiro da API é entrega de mapa de graça.
     */
    enabled:
      process.env.SWAGGER_ENABLED === 'true' ||
      (process.env.NODE_ENV ?? 'development') !== 'production',
  },
  mediaSearch: {
    spotifyClientId: process.env.SPOTIFY_CLIENT_ID,
    spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    youtubeApiKey: process.env.YOUTUBE_API_KEY,
    frontendBaseUrl: process.env.FRONTEND_BASE_URL ?? 'http://localhost:3000',
  },
  auth: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
    /**
     * Domínio dos cookies da sessão. Em produção deve ser o domínio raiz
     * (`.opusatlas.com.br`) para a sessão valer nas 4 zonas do front sem novo
     * login. Vazio em desenvolvimento (localhost não aceita domínio com ponto).
     */
    cookieDomain: process.env.AUTH_COOKIE_DOMAIN,
    /**
     * Login com o Google (fluxo de código com PKCE, feito pela API). O
     * `redirectUri` é o endereço público de `GET /api/auth/google/callback` e
     * precisa estar cadastrado no Google Cloud Console exatamente igual.
     */
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
    },
  },
  security: {
    apiKey: process.env.API_KEY,
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  storage: {
    // Todo arquivo da plataforma vive no Cloudinary. Não há mais gravação em
    // disco local: um contêiner é efêmero e réplicas não compartilham disco,
    // então arquivo salvo localmente some no próximo deploy e não é visível
    // para as outras instâncias.
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
  backup: {
    /**
     * O backup **não** mora no Cloudinary, que é onde vivem os arquivos da
     * plataforma. Dois motivos, e os dois são eliminatórios: o Cloudinary
     * entrega por URL pública, e um backup tem e-mail, hash de senha e
     * histórico de pagamento de todo mundo; e o limite de arquivo bruto dele
     * (10 MB no gratuito, ~100 MB nos pagos) não comporta o dump.
     *
     * O R2 é bucket privado, compatível com S3, sem taxa de saída. Nada aqui
     * é obrigatório: sem configuração, a tarefa de backup recusa rodar e diz
     * o que falta, em vez de a aplicação não subir.
     */
    r2AccountId: process.env.BACKUP_R2_ACCOUNT_ID,
    r2AccessKeyId: process.env.BACKUP_R2_ACCESS_KEY_ID,
    r2SecretAccessKey: process.env.BACKUP_R2_SECRET_ACCESS_KEY,
    r2Bucket: process.env.BACKUP_R2_BUCKET,
    /** Prefixo dentro do bucket, para conviver com outras coisas. */
    prefix: process.env.BACKUP_R2_PREFIX ?? 'backups',
  },
  billing: {
    // Mesmo padrão dual test/produção do legado (`stripeClient.ts`) — em
    // desenvolvimento sempre usa a chave de teste, mesmo com NODE_ENV=production
    // não setado localmente.
    stripeSecretKey:
      process.env.NODE_ENV === 'production'
        ? process.env.STRIPE_SECRET_KEY
        : (process.env.STRIPE_SECRET_KEY_TEST ?? process.env.STRIPE_SECRET_KEY),
    stripeWebhookSecret:
      process.env.NODE_ENV === 'production'
        ? process.env.STRIPE_WEBHOOK_SECRET
        : (process.env.STRIPE_WEBHOOK_SECRET_TEST ??
          process.env.STRIPE_WEBHOOK_SECRET),
    // IDs de Price já criados no dashboard do Stripe — nunca criar Product/Price
    // dinamicamente a cada checkout (o legado tinha uma implementação que fazia
    // isso, poluindo o dashboard; ver Fase 2G do ROADMAP).
    priceIds: {
      PLUS: {
        MONTHLY: process.env.STRIPE_PRICE_PLUS_MONTHLY,
        YEARLY: process.env.STRIPE_PRICE_PLUS_YEARLY,
      },
      MENTOR: {
        MONTHLY: process.env.STRIPE_PRICE_MENTOR_MONTHLY,
        YEARLY: process.env.STRIPE_PRICE_MENTOR_YEARLY,
      },
      MAESTRO: {
        MONTHLY: process.env.STRIPE_PRICE_MAESTRO_MONTHLY,
        YEARLY: process.env.STRIPE_PRICE_MAESTRO_YEARLY,
      },
    },
  },
  mail: {
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.EMAIL_FROM ?? 'Opus Atlas <noreply@opusatlas.com>',
    replyTo: process.env.EMAIL_REPLY_TO ?? 'contato@opusatlas.com',
    /**
     * Segredo de assinatura do webhook de entrega (Svix, usado pelo Resend).
     *
     * Sem ele a rota recusa tudo: não há como distinguir o provedor de um
     * estranho, e um `email.bounced` forjado desinscreve assinante.
     */
    webhookSecret: process.env.EMAIL_WEBHOOK_SECRET,
    supportTo: process.env.SUPPORT_EMAIL ?? 'suporte@opusatlas.com',
  },
  /**
   * Provedores de IA, em cascata — ver `AiTextService`. A ordem é a da
   * variável; provedor sem chave é pulado.
   */
  ai: {
    providerOrder: (process.env.AI_PROVIDER_ORDER ?? 'anthropic,openai,groq')
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-5',
      effort: process.env.ANTHROPIC_EFFORT ?? 'medium',
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    },
    groq: {
      apiKey: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b',
    },
    timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 60_000),
    /** Chamadas de IA por dia para biografia (geração + tradução). */
    bioDailyLimit: Number(process.env.AI_BIO_DAILY_LIMIT ?? 200),
  },
  /** Aviso de dado novo ao front — ver `RevalidationService`. */
  revalidation: {
    url: process.env.FRONT_REVALIDATE_URL,
    secret: process.env.FRONT_REVALIDATE_SECRET,
  },
});
