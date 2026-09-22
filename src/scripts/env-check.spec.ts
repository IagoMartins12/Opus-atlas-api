import { conferirAmbiente } from './env-check';

/** Um .env.hml correto; cada teste estraga uma coisa. */
const HML = {
  APP_ENV: 'hml',
  NODE_ENV: 'staging',
  DATABASE_URL: 'mongodb+srv://u:p@hml.abc.mongodb.net/opus-hml',
  REDIS_URL: 'redis://red-abc:6379',
  JWT_ACCESS_SECRET: 'h'.repeat(40),
  JWT_REFRESH_SECRET: 'i'.repeat(40),
  API_KEY: 'j'.repeat(40),
  FRONT_REVALIDATE_SECRET: 'k'.repeat(40),
  FRONT_REVALIDATE_URL: 'https://hml.opusatlas.com.br/api/revalidate',
  ALLOWED_ORIGINS: 'https://hml.opusatlas.com.br',
  FRONTEND_BASE_URL: 'https://hml.opusatlas.com.br',
  AUTH_COOKIE_DOMAIN: '.hml.opusatlas.com.br',
  AUTH_COOKIE_PREFIX: 'opus_hml',
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'segredo-hml',
  GOOGLE_OAUTH_REDIRECT_URI:
    'https://api.hml.opusatlas.com.br/api/auth/google/callback',
  SMTP_HOST: 'smtp.resend.com',
  SMTP_USER: 'resend',
  SMTP_PASS: 're_hml',
  EMAIL_FROM: 'Opus Atlas <noreply@opusatlas.com.br>',
  EMAIL_WEBHOOK_SECRET: 'whsec_x',
  CLOUDINARY_CLOUD_NAME: 'n',
  CLOUDINARY_API_KEY: 'k',
  CLOUDINARY_API_SECRET: 's',
  STRIPE_SECRET_KEY_TEST: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET_TEST: 'whsec_test',
  STRIPE_PRICE_PLUS_MONTHLY: 'price_1',
  STRIPE_PRICE_PLUS_YEARLY: 'price_2',
  STRIPE_PRICE_MENTOR_MONTHLY: 'price_3',
  STRIPE_PRICE_MENTOR_YEARLY: 'price_4',
  STRIPE_PRICE_MAESTRO_MONTHLY: 'price_5',
  STRIPE_PRICE_MAESTRO_YEARLY: 'price_6',
  BACKUP_R2_ACCOUNT_ID: 'a',
  BACKUP_R2_ACCESS_KEY_ID: 'b',
  BACKUP_R2_SECRET_ACCESS_KEY: 'c',
  BACKUP_R2_BUCKET: 'd',
  GOOGLE_APPLICATION_CREDENTIALS: '/etc/secrets/google-tts.json',
};

const PRD = {
  ...HML,
  APP_ENV: 'prd',
  NODE_ENV: 'production',
  DATABASE_URL: 'mongodb+srv://u:p@prd.xyz.mongodb.net/opus',
  REDIS_URL: 'redis://redis:6379',
  JWT_ACCESS_SECRET: 'p'.repeat(40),
  JWT_REFRESH_SECRET: 'q'.repeat(40),
  API_KEY: 'r'.repeat(40),
  FRONT_REVALIDATE_SECRET: 's'.repeat(40),
  FRONT_REVALIDATE_URL: 'https://opusatlas.com.br/api/revalidate',
  ALLOWED_ORIGINS: 'https://opusatlas.com.br,https://www.opusatlas.com.br',
  FRONTEND_BASE_URL: 'https://opusatlas.com.br',
  AUTH_COOKIE_DOMAIN: '.opusatlas.com.br',
  AUTH_COOKIE_PREFIX: '',
  GOOGLE_OAUTH_REDIRECT_URI:
    'https://api.opusatlas.com.br/api/auth/google/callback',
  STRIPE_SECRET_KEY_TEST: '',
  STRIPE_WEBHOOK_SECRET_TEST: '',
  STRIPE_SECRET_KEY: 'sk_live_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_live',
  SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/1',
};

const erros = (nome: 'hml' | 'prd', env: Record<string, string>, outros = {}) =>
  conferirAmbiente(nome, env, outros).erros.join('\n');
const avisos = (nome: 'hml' | 'prd', env: Record<string, string>) =>
  conferirAmbiente(nome, env, {}).avisos.join('\n');

describe('env-check — conferirAmbiente', () => {
  it('aceita homologação e produção corretas', () => {
    expect(erros('hml', HML, { prd: PRD })).toBe('');
    expect(erros('prd', PRD, { hml: HML })).toBe('');
  });

  it('acusa JWT igual entre ambientes — token de um valeria no outro', () => {
    expect(
      erros(
        'prd',
        { ...PRD, JWT_ACCESS_SECRET: HML.JWT_ACCESS_SECRET },
        { hml: HML },
      ),
    ).toContain('JWT_ACCESS_SECRET é igual ao de hml');
  });

  it('acusa homologação e produção no mesmo banco', () => {
    expect(
      erros('hml', { ...HML, DATABASE_URL: PRD.DATABASE_URL }, { prd: PRD }),
    ).toContain('DATABASE_URL é igual ao de prd');
  });

  it('só avisa (não erra) segredo de serviço compartilhado', () => {
    const r = conferirAmbiente(
      'hml',
      { ...HML, SMTP_PASS: PRD.SMTP_PASS },
      { prd: PRD },
    );
    expect(r.erros.join()).not.toContain('SMTP_PASS');
    expect(r.avisos.join()).toContain('SMTP_PASS é igual ao de prd');
  });

  it('acusa localhost em ambiente publicado', () => {
    const e = erros('hml', {
      ...HML,
      DATABASE_URL: 'mongodb://localhost:27017/classical_hub',
      ALLOWED_ORIGINS: 'http://localhost:3000',
      FRONTEND_BASE_URL: 'http://localhost:3000',
    });
    expect(e).toContain('DATABASE_URL aponta para localhost');
    expect(e).toContain('ALLOWED_ORIGINS inclui localhost');
    expect(e).toContain('FRONTEND_BASE_URL precisa ser https://');
  });

  it('acusa CORS que não inclui o próprio front', () => {
    expect(
      erros('prd', { ...PRD, ALLOWED_ORIGINS: 'https://www.opusatlas.com.br' }),
    ).toContain('ALLOWED_ORIGINS não inclui o FRONTEND_BASE_URL');
  });

  it('acusa domínio de cookie que não cobre o site', () => {
    expect(
      erros('hml', { ...HML, AUTH_COOKIE_DOMAIN: '.opusatlas.com' }),
    ).toContain('AUTH_COOKIE_DOMAIN não cobre');
  });

  it('exige o prefixo de cookie da homologação', () => {
    expect(erros('hml', { ...HML, AUTH_COOKIE_PREFIX: '' })).toContain(
      'AUTH_COOKIE_PREFIX deveria ser opus_hml',
    );
  });

  it('recusa a chave viva do Stripe na homologação', () => {
    expect(erros('hml', { ...HML, STRIPE_SECRET_KEY: 'sk_live_x' })).toContain(
      'chave VIVA do Stripe',
    );
  });

  it('recusa chave de teste do Stripe em produção', () => {
    expect(erros('prd', { ...PRD, STRIPE_SECRET_KEY: 'sk_test_x' })).toContain(
      'não é uma chave viva',
    );
  });

  it('avisa preços do Stripe vazios, que quebram o checkout', () => {
    expect(avisos('prd', { ...PRD, STRIPE_PRICE_PLUS_YEARLY: '' })).toContain(
      '1 de 6 preços do Stripe vazios',
    );
  });

  it('avisa remetente de domínio próprio saindo pelo Gmail', () => {
    expect(
      avisos('prd', {
        ...PRD,
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_USER: 'x@gmail.com',
      }),
    ).toContain('SMTP do Gmail com remetente de outro domínio');
  });

  it('acusa backup do R2 configurado pela metade', () => {
    expect(erros('prd', { ...PRD, BACKUP_R2_BUCKET: '' })).toContain(
      'backup R2 pela metade: BACKUP_R2_BUCKET',
    );
  });

  it('acusa o par APP_ENV/NODE_ENV trocado', () => {
    expect(erros('prd', { ...PRD, NODE_ENV: 'staging' })).toContain(
      'NODE_ENV deveria ser "production"',
    );
  });

  it('inclui o que o boot recusaria', () => {
    const { API_KEY: _omitido, ...sem } = PRD;
    expect(erros('prd', sem)).toContain('API_KEY');
  });

  it('nunca escreve um valor na saída', () => {
    const ruim = {
      ...PRD,
      JWT_ACCESS_SECRET: HML.JWT_ACCESS_SECRET,
      STRIPE_SECRET_KEY: 'sk_test_SEGREDO',
    };
    const r = conferirAmbiente('prd', ruim, { hml: HML });
    const saida = [...r.erros, ...r.avisos].join('\n');
    expect(saida).not.toContain(HML.JWT_ACCESS_SECRET);
    expect(saida).not.toContain('SEGREDO');
    expect(saida).not.toContain('u:p@');
  });
});

describe('env-check — máscara', () => {
  it('esconde valor citado por mensagem do Joi', () => {
    const r = conferirAmbiente(
      'prd',
      { ...PRD, AI_PROVIDER_ORDER: 'anthropic,segredo-no-meio' },
      {},
    );
    expect([...r.erros, ...r.avisos].join('\n')).not.toContain(
      'segredo-no-meio',
    );
  });
});

describe('env-check — nome do banco', () => {
  it.each([
    'mongodb+srv://u:p@hml.abc.mongodb.net/',
    'mongodb+srv://u:p@hml.abc.mongodb.net/?retryWrites=true',
    'mongodb+srv://u:p@hml.abc.mongodb.net',
  ])('acusa URL sem nome de banco: %s', (url) => {
    const r = conferirAmbiente('hml', { ...HML, DATABASE_URL: url }, {});
    expect(r.erros.join()).toContain('DATABASE_URL sem nome de banco');
  });
});
