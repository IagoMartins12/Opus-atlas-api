import { envValidationSchema, validateEnv } from './env.validation';
import {
  appEnvOf,
  assertNoRootDotEnv,
  envFileOf,
  EXPECTED_NODE_ENV,
} from './env-files';

describe('env por ambiente', () => {
  it('sem APP_ENV é local, no .env.local', () => {
    expect(appEnvOf({})).toBe('local');
    expect(envFileOf('local')).toBe('.env.local');
  });

  // O Prisma Client carrega o .env sozinho — e ele venceria o .env.prd.
  it('um .env solto na raiz derruba o boot', () => {
    expect(() =>
      assertNoRootDotEnv('/api', (path) => path === '/api/.env'),
    ).toThrow(/renomeie para .env.local/);
    expect(() => assertNoRootDotEnv('/api', () => false)).not.toThrow();
  });

  it('hml e prd têm arquivo próprio', () => {
    expect(envFileOf(appEnvOf({ APP_ENV: ' HML ' }))).toBe('.env.hml');
    expect(envFileOf(appEnvOf({ APP_ENV: 'prd' }))).toBe('.env.prd');
  });

  it('valor desconhecido derruba o boot em vez de cair no local', () => {
    expect(() => appEnvOf({ APP_ENV: 'producao' })).toThrow(/APP_ENV inválido/);
  });

  describe('validação', () => {
    const base = {
      DATABASE_URL: 'mongodb://localhost:27017/x',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
    };

    it('prd com NODE_ENV que não é production é recusado', () => {
      const { error } = envValidationSchema.validate({
        ...base,
        APP_ENV: 'prd',
        NODE_ENV: 'development',
      });

      expect(error?.message).toContain('APP_ENV=prd exige NODE_ENV=production');
    });

    it('prd exige as credenciais do login com Google', () => {
      const { error } = envValidationSchema.validate(
        { ...base, APP_ENV: 'prd', NODE_ENV: 'production' },
        { abortEarly: false },
      );

      expect(error?.message).toContain('"GOOGLE_CLIENT_ID" is required');
      expect(error?.message).toContain(
        '"GOOGLE_OAUTH_REDIRECT_URI" is required',
      );
    });

    it('hml roda como staging', () => {
      const { error } = envValidationSchema.validate({
        ...base,
        APP_ENV: 'hml',
        NODE_ENV: EXPECTED_NODE_ENV.hml,
      });

      expect(error).toBeUndefined();
    });

    // `SENTRY_DSN=` no arquivo é "não configurado", não um DSN inválido.
    it('variável vazia conta como não definida', () => {
      const config = validateEnv({
        ...base,
        SENTRY_DSN: '',
        ANTHROPIC_API_KEY: '   ',
        API_KEY: '',
      });

      expect(config).not.toHaveProperty('SENTRY_DSN');
      expect(config).not.toHaveProperty('ANTHROPIC_API_KEY');
    });

    it('obrigatória vazia continua obrigatória, e o erro diz qual', () => {
      expect(() => validateEnv({ ...base, DATABASE_URL: '' })).toThrow(
        /Configuração de ambiente inválida: "DATABASE_URL" is required/,
      );
    });

    it('ordem da IA só aceita provedores conhecidos', () => {
      expect(
        envValidationSchema.validate({
          ...base,
          AI_PROVIDER_ORDER: 'anthropic, openai,groq',
        }).error,
      ).toBeUndefined();
      expect(
        envValidationSchema.validate({
          ...base,
          AI_PROVIDER_ORDER: 'anthropic,gemini',
        }).error?.message,
      ).toContain('AI_PROVIDER_ORDER aceita anthropic, openai e groq');
    });
  });
});
