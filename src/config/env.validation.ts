import * as Joi from 'joi';
import { APP_ENVS } from './env-files';

/**
 * Exige a variável apenas em produção, mantendo-a opcional nos demais
 * ambientes. É o que permite rodar o projeto localmente sem Stripe nem SMTP
 * configurados, sem abrir mão do fail-fast em produção (SPEC §3.8).
 */
const requiredInProduction = (schema: Joi.StringSchema) =>
  schema.when('NODE_ENV', {
    is: 'production',
    then: schema.required(),
    otherwise: schema.optional(),
  });

/**
 * Schema de validação das variáveis de ambiente.
 *
 * A aplicação falha ao subir se alguma variável obrigatória estiver ausente ou
 * inválida. Isso troca um erro silencioso em runtime — descoberto quando o
 * primeiro usuário tenta pagar ou receber e-mail — por um erro de boot, que o
 * deploy detecta antes de servir tráfego.
 */
export const envValidationSchema = Joi.object({
  APP_ENV: Joi.string()
    .valid(...APP_ENVS)
    .default('local')
    .description('Qual arquivo .env foi lido — ver env-files.ts'),

  // O arquivo de produção precisa rodar como produção: `.env.prd` com
  // NODE_ENV=development cobraria na chave de teste do Stripe e ligaria o
  // Swagger, em silêncio.
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'staging', 'production')
    .default('development')
    .when('APP_ENV', {
      is: 'prd',
      then: Joi.valid(Joi.override, 'production').messages({
        'any.only': 'APP_ENV=prd exige NODE_ENV=production',
      }),
    }),
  PORT: Joi.number().port().default(4000),
  TRUST_PROXY_HOPS: Joi.number().min(0).default(1),

  DATABASE_URL: Joi.string().uri().required(),
  // Conexões por processo. Sem teto, cada réplica abre até 100 e o cluster
  // estoura no pico — ver `prisma/pool.ts` e SPEC §10.5.
  BACKUP_R2_ACCOUNT_ID: Joi.string().optional(),
  BACKUP_R2_ACCESS_KEY_ID: Joi.string().optional(),
  BACKUP_R2_SECRET_ACCESS_KEY: Joi.string().optional(),
  BACKUP_R2_BUCKET: Joi.string().optional(),
  BACKUP_R2_PREFIX: Joi.string().optional(),
  DATABASE_MAX_POOL_SIZE: Joi.number().integer().min(1).optional(),
  DATABASE_MIN_POOL_SIZE: Joi.number().integer().min(0).optional(),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  AUTH_COOKIE_DOMAIN: Joi.string()
    .optional()
    .description(
      'Domínio raiz dos cookies da sessão, ex.: .opusatlas.com.br — permite a mesma ' +
        'sessão nas 4 zonas do front. Vazio em desenvolvimento.',
    ),

  // Login com Google, feito pela API. Obrigatório em produção — sem ele some
  // metade das entradas do site. Fora dela, faltando qualquer um dos três,
  // `GET /auth/google` volta ao front com `authError=google_unavailable`.
  GOOGLE_CLIENT_ID: requiredInProduction(Joi.string()),
  GOOGLE_CLIENT_SECRET: requiredInProduction(Joi.string()),
  GOOGLE_OAUTH_REDIRECT_URI: requiredInProduction(
    Joi.string().uri(),
  ).description(
    'Endereço público de GET /api/auth/google/callback, igual ao cadastrado no Google Cloud Console',
  ),

  // Redis deixa de ser opcional em produção: além do cache, ele é o storage do
  // rate limit compartilhado entre instâncias — sem ele o limite deixa de valer
  // assim que a API roda com mais de uma réplica.
  REDIS_URL: requiredInProduction(
    Joi.string().uri({ scheme: ['redis', 'rediss'] }),
  ).default('redis://localhost:6379'),

  // Papel do processo em relação à fila. `all` faz o mesmo processo enfileirar
  // e consumir, que é o certo para desenvolvimento e para quem sobe um
  // contêiner só; os alvos `api` e `worker` do Dockerfile é que separam.
  QUEUE_ROLE: Joi.string()
    .valid('api', 'worker', 'all')
    .default('all')
    .description(
      'api = só enfileira; worker = só consome; all = os dois no mesmo processo',
    ),

  ALLOWED_ORIGINS: requiredInProduction(Joi.string())
    .default('http://localhost:3000')
    .description(
      'Lista de origens separadas por vírgula, ex.: https://opusatlas.com.br,https://www.opusatlas.com.br',
    ),

  THROTTLE_TTL: Joi.number().default(60),
  THROTTLE_LIMIT: Joi.number().default(100),

  API_KEY: requiredInProduction(Joi.string().min(32)).description(
    'Chave usada por rotas server-to-server (cron, /metrics, scrapers)',
  ),

  SWAGGER_ENABLED: Joi.string().valid('true', 'false').optional(),

  SPOTIFY_CLIENT_ID: Joi.string().optional(),
  SPOTIFY_CLIENT_SECRET: Joi.string().optional(),
  YOUTUBE_API_KEY: Joi.string().optional(),
  FRONTEND_BASE_URL: requiredInProduction(Joi.string().uri()),

  // E-mail transacional (confirmação de conta, reset de senha) é caminho
  // crítico: sem SMTP em produção, ninguém consegue criar conta nem recuperar
  // acesso, e a falha só aparece no primeiro cadastro.
  SMTP_HOST: requiredInProduction(Joi.string()),
  SMTP_PORT: Joi.number().port().optional(),
  SMTP_SECURE: Joi.string().valid('true', 'false').optional(),
  SMTP_USER: requiredInProduction(Joi.string()),
  SMTP_PASS: requiredInProduction(Joi.string()),
  EMAIL_FROM: Joi.string().optional(),
  EMAIL_REPLY_TO: Joi.string().optional(),
  // Sem ele o webhook de entrega recusa tudo — e sem webhook, `emailsDelivered`
  // e a taxa de entrega voltam a não ter quem escreva.
  EMAIL_WEBHOOK_SECRET: Joi.string().optional(),

  // Aviso de dado novo ao front (Etapa 1.7). Sem URL, desligado; com URL, o
  // segredo é obrigatório — um endpoint de revalidação aberto é um botão de
  // "esvaziar o cache do site" para qualquer um.
  FRONT_REVALIDATE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .optional(),
  FRONT_REVALIDATE_SECRET: Joi.string().min(32).when('FRONT_REVALIDATE_URL', {
    is: Joi.exist(),
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  SUPPORT_EMAIL: Joi.string().optional(),

  // Biografia de compositor por IA, em cascata. Sem nenhuma chave, a geração
  // responde 503 e o resto da API sobe normalmente.
  AI_PROVIDER_ORDER: Joi.string()
    .pattern(
      /^\s*(anthropic|openai|groq)(\s*,\s*(anthropic|openai|groq))*\s*$/i,
    )
    .optional()
    .messages({
      'string.pattern.base':
        'AI_PROVIDER_ORDER aceita anthropic, openai e groq, separados por vírgula',
    }),
  ANTHROPIC_API_KEY: Joi.string().optional(),
  ANTHROPIC_MODEL: Joi.string().optional(),
  ANTHROPIC_EFFORT: Joi.string().valid('low', 'medium', 'high').optional(),
  OPENAI_API_KEY: Joi.string().optional(),
  OPENAI_MODEL: Joi.string().optional(),
  GROQ_API_KEY: Joi.string().optional(),
  GROQ_MODEL: Joi.string().optional(),
  AI_TIMEOUT_MS: Joi.number().min(1000).optional(),
  AI_BIO_DAILY_LIMIT: Joi.number().min(0).optional(),

  // Billing: as chaves de produção são obrigatórias em produção; as de teste
  // permanecem opcionais e são as usadas em qualquer outro ambiente.
  STRIPE_SECRET_KEY: requiredInProduction(Joi.string()),
  STRIPE_WEBHOOK_SECRET: requiredInProduction(Joi.string()),
  STRIPE_SECRET_KEY_TEST: Joi.string().optional(),
  STRIPE_WEBHOOK_SECRET_TEST: Joi.string().optional(),
  STRIPE_PRICE_PLUS_MONTHLY: Joi.string().optional(),
  STRIPE_PRICE_PLUS_YEARLY: Joi.string().optional(),
  STRIPE_PRICE_MENTOR_MONTHLY: Joi.string().optional(),
  STRIPE_PRICE_MENTOR_YEARLY: Joi.string().optional(),
  STRIPE_PRICE_MAESTRO_MONTHLY: Joi.string().optional(),
  STRIPE_PRICE_MAESTRO_YEARLY: Joi.string().optional(),

  // Armazenamento de arquivos. Obrigatório em produção: sem isso nenhum upload
  // funciona, e a falha só apareceria no primeiro envio de um usuário.
  CLOUDINARY_CLOUD_NAME: requiredInProduction(Joi.string()),
  CLOUDINARY_API_KEY: requiredInProduction(Joi.string()),
  CLOUDINARY_API_SECRET: requiredInProduction(Joi.string()),

  SENTRY_DSN: Joi.string().uri().optional(),
  SENTRY_RELEASE: Joi.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: Joi.number().min(0).max(1).optional(),
  GIT_COMMIT_SHA: Joi.string().optional(),

  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),
}).unknown(true);

/**
 * Valida o ambiente tratando **variável vazia como não definida**.
 *
 * `SENTRY_DSN=` num `.env` chega como string vazia, e o Joi recusa string
 * vazia — a API não subia com o próprio `.env.example` copiado como está. Vazio
 * aqui quer dizer "não configurado", e o que é obrigatório continua
 * obrigatório.
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const defined = Object.fromEntries(
    Object.entries(config).filter(
      ([, value]) => !(typeof value === 'string' && value.trim() === ''),
    ),
  );
  const { error, value } = envValidationSchema.validate(defined, {
    abortEarly: false,
  });

  if (error) {
    throw new Error(`Configuração de ambiente inválida: ${error.message}`);
  }

  return value as Record<string, unknown>;
}
