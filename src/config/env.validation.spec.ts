import { validateEnv } from './env.validation';

/**
 * O que esta suíte protege.
 *
 * A validação de ambiente é o único ponto do sistema que transforma "faltou uma
 * credencial" num erro de boot, em vez de num defeito que aparece semanas
 * depois, no primeiro usuário que tenta pagar ou receber e-mail. Ela nunca teve
 * teste — e passou a ter quando a homologação entrou em cena e revelou que
 * `staging` não cobrava nada.
 *
 * O caso mais escorregadio está em `ALLOWED_ORIGINS` e `REDIS_URL`: ambos
 * declaram `.default(...)` **e** viram obrigatórios em ambiente publicado. Se o
 * Joi aplicasse o default antes de conferir a presença, o `required()` seria
 * decorativo e a API subiria em homologação apontando para `localhost`. Os
 * testes abaixo fixam que não é o que acontece.
 */

/** O mínimo que qualquer ambiente exige, inclusive o local. */
const MINIMO = {
  DATABASE_URL: 'mongodb://localhost:27017/opus',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

/** Tudo que um ambiente publicado precisa, fora o par do Stripe. */
const PUBLICADO = {
  ...MINIMO,
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'segredo',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://api.exemplo.com/api/auth/google/callback',
  REDIS_URL: 'rediss://cache.exemplo.com:6379',
  ALLOWED_ORIGINS: 'https://exemplo.com',
  API_KEY: 'k'.repeat(32),
  FRONTEND_BASE_URL: 'https://exemplo.com',
  SMTP_HOST: 'smtp.exemplo.com',
  SMTP_USER: 'usuario',
  SMTP_PASS: 'senha',
  CLOUDINARY_CLOUD_NAME: 'nuvem',
  CLOUDINARY_API_KEY: 'chave',
  CLOUDINARY_API_SECRET: 'segredo',
};

const homologacao = (extra: Record<string, unknown> = {}) => ({
  ...PUBLICADO,
  NODE_ENV: 'staging',
  STRIPE_SECRET_KEY_TEST: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET_TEST: 'whsec_test_x',
  ...extra,
});

const producao = (extra: Record<string, unknown> = {}) => ({
  ...PUBLICADO,
  NODE_ENV: 'production',
  STRIPE_SECRET_KEY: 'sk_live_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_live_x',
  ...extra,
});

/** Roda a validação e devolve a mensagem de erro, ou null se passou. */
function erroDe(config: Record<string, unknown>): string | null {
  try {
    validateEnv(config);
    return null;
  } catch (e) {
    return String(e);
  }
}

describe('validateEnv', () => {
  describe('desenvolvimento', () => {
    it('sobe sem nenhuma credencial externa', () => {
      expect(erroDe({ ...MINIMO, NODE_ENV: 'development' })).toBeNull();
    });

    it('aplica os defaults de localhost quando nada é informado', () => {
      const valor = validateEnv({ ...MINIMO, NODE_ENV: 'development' });

      expect(valor.ALLOWED_ORIGINS).toBe('http://localhost:3000');
      expect(valor.REDIS_URL).toBe('redis://localhost:6379');
    });

    it('recusa subir sem as chaves de JWT, em qualquer ambiente', () => {
      const { JWT_ACCESS_SECRET: _omitido, ...semJwt } = MINIMO;

      expect(erroDe({ ...semJwt, NODE_ENV: 'development' })).toContain(
        'JWT_ACCESS_SECRET',
      );
    });
  });

  describe('homologação', () => {
    it('aceita um ambiente completo', () => {
      expect(erroDe(homologacao())).toBeNull();
    });

    /**
     * O teste que justifica a suíte: o default `http://localhost:3000` não pode
     * satisfazer o `required()`. Se este quebrar, a homologação volta a subir
     * com o CORS apontando para a máquina de quem desenvolve, e o front
     * hospedado é recusado sem explicação.
     */
    it('exige ALLOWED_ORIGINS mesmo havendo default de localhost', () => {
      const { ALLOWED_ORIGINS: _omitido, ...sem } = homologacao();

      expect(erroDe(sem)).toContain('ALLOWED_ORIGINS');
    });

    it('exige REDIS_URL mesmo havendo default de localhost', () => {
      const { REDIS_URL: _omitido, ...sem } = homologacao();

      expect(erroDe(sem)).toContain('REDIS_URL');
    });

    it.each([
      'API_KEY',
      'FRONTEND_BASE_URL',
      'SMTP_HOST',
      'CLOUDINARY_API_SECRET',
      'GOOGLE_CLIENT_ID',
    ])('exige %s', (chave) => {
      const sem = { ...homologacao() };
      delete sem[chave as keyof typeof sem];

      expect(erroDe(sem)).toContain(chave);
    });

    it('trata variável vazia como ausente', () => {
      expect(erroDe(homologacao({ ALLOWED_ORIGINS: '   ' }))).toContain(
        'ALLOWED_ORIGINS',
      );
    });

    /**
     * Homologação cobra o par de **teste** do Stripe, porque é o que
     * `configuration.ts` escolhe quando `NODE_ENV !== 'production'`. Cobrar a
     * chave viva obrigaria a colocá-la num ambiente que não deve possuí-la.
     */
    it('exige o par de teste do Stripe, não o de produção', () => {
      const { STRIPE_SECRET_KEY_TEST: _omitido, ...sem } = homologacao();

      expect(erroDe(sem)).toContain('STRIPE_SECRET_KEY_TEST');
    });

    it('não exige a chave viva do Stripe', () => {
      expect(erroDe(homologacao())).toBeNull();
    });
  });

  describe('prefixo dos cookies', () => {
    it('aceita o prefixo da homologação', () => {
      expect(
        erroDe(homologacao({ AUTH_COOKIE_PREFIX: 'opus_hml' })),
      ).toBeNull();
    });

    it.each(['opus-hml', 'Opus', '1opus'])('recusa "%s"', (prefixo) => {
      expect(erroDe(homologacao({ AUTH_COOKIE_PREFIX: prefixo }))).toContain(
        'AUTH_COOKIE_PREFIX',
      );
    });
  });

  describe('produção', () => {
    it('aceita um ambiente completo', () => {
      expect(erroDe(producao())).toBeNull();
    });

    it('exige a chave viva do Stripe', () => {
      const { STRIPE_SECRET_KEY: _omitido, ...sem } = producao();

      expect(erroDe(sem)).toContain('STRIPE_SECRET_KEY');
    });

    it('não exige o par de teste do Stripe', () => {
      expect(erroDe(producao())).toBeNull();
    });

    it('exige o que homologação também exige', () => {
      const { CLOUDINARY_API_KEY: _omitido, ...sem } = producao();

      expect(erroDe(sem)).toContain('CLOUDINARY_API_KEY');
    });

    it('recusa APP_ENV=prd com NODE_ENV que não seja production', () => {
      expect(
        erroDe(producao({ APP_ENV: 'prd', NODE_ENV: 'staging' })),
      ).toContain('NODE_ENV');
    });
  });
});
