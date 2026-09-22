import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'dotenv';
import { validateEnv } from '../config/env.validation';
import { APP_ENVS, type AppEnv } from '../config/env-files';

/**
 * Confere um arquivo `.env.<ambiente>` **sem subir a aplicação**.
 *
 * O boot já recusa variável obrigatória ausente. Este script roda a mesma
 * validação e acrescenta o que o boot não tem como saber, porque depende de
 * olhar os outros ambientes ou de conhecer o significado do valor:
 *
 * - segredo **igual** ao de outro ambiente (um JWT de homologação valeria em
 *   produção);
 * - chave do Stripe do modo errado (`sk_test_` em produção);
 * - domínio do cookie que não cobre o site, origem do CORS que não inclui o
 *   próprio front, endereço `http://` ou `localhost` em ambiente publicado;
 * - o que é opcional para subir mas quebra na primeira vez que alguém usa
 *   (preços do Stripe, webhook de e-mail).
 *
 * **Nunca imprime valor** — só nomes. A saída pode ir para um chat ou um log.
 *
 * Uso:  npm run env:check -- hml
 *       npm run env:check -- prd
 */

export interface Relatorio {
  erros: string[];
  avisos: string[];
}

type Env = Record<string, string>;

/** Segredos que não podem se repetir entre ambientes. */
const SEGREDOS_EXCLUSIVOS = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'API_KEY',
  'FRONT_REVALIDATE_SECRET',
  'DATABASE_URL',
  'REDIS_URL',
];

/** Recomendado separar por ambiente, mas não é erro compartilhar. */
const SEGREDOS_RECOMENDADO_SEPARAR = [
  'SMTP_PASS',
  'GOOGLE_CLIENT_SECRET',
  'OPENAI_API_KEY',
  'GROQ_API_KEY',
  'ANTHROPIC_API_KEY',
  'YOUTUBE_API_KEY',
  'BACKUP_R2_SECRET_ACCESS_KEY',
];

const PRECOS = [
  'STRIPE_PRICE_PLUS_MONTHLY',
  'STRIPE_PRICE_PLUS_YEARLY',
  'STRIPE_PRICE_MENTOR_MONTHLY',
  'STRIPE_PRICE_MENTOR_YEARLY',
  'STRIPE_PRICE_MAESTRO_MONTHLY',
  'STRIPE_PRICE_MAESTRO_YEARLY',
];

function host(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function hostDoBanco(url: string | undefined): string | null {
  if (!url) return null;
  const depois = url.replace(/^[a-z+]+:\/\//, '');
  return depois.slice(depois.lastIndexOf('@') + 1).split(/[/?]/)[0] || null;
}

function nomeDoBanco(url: string): string {
  const depois = url.replace(/^[a-z+]+:\/\//, '');
  const caminho = depois.slice(depois.lastIndexOf('@') + 1);
  const barra = caminho.indexOf('/');
  return barra < 0
    ? ''
    : caminho
        .slice(barra + 1)
        .split('?')[0]
        .trim();
}

/**
 * As checagens, puras: recebem os valores e devolvem mensagens com **nomes**,
 * nunca valores.
 */
export function conferirAmbiente(
  nome: AppEnv,
  env: Env,
  outros: Partial<Record<AppEnv, Env>>,
): Relatorio {
  const erros: string[] = [];
  const avisos: string[] = [];
  const publicado = nome !== 'local';
  const tem = (k: string) => Boolean(env[k]?.trim());

  // 1. A mesma validação do boot.
  try {
    validateEnv({ ...env });
  } catch (e) {
    const texto = String(e).replace(
      /^Error: Configuração de ambiente inválida: /,
      '',
    );
    for (const parte of texto.split('. ')) {
      if (parte.trim()) erros.push(`boot: ${parte.trim().replace(/\.$/, '')}`);
    }
  }

  // 2. O par APP_ENV / NODE_ENV esperado para o arquivo.
  const esperado = { local: 'development', hml: 'staging', prd: 'production' };
  if (env.APP_ENV !== nome) {
    erros.push(`APP_ENV deveria ser "${nome}" neste arquivo`);
  }
  if (env.NODE_ENV !== esperado[nome]) {
    erros.push(`NODE_ENV deveria ser "${esperado[nome]}" em ${nome}`);
  }

  // 3. Segredos repetidos entre ambientes.
  for (const [outro, valores] of Object.entries(outros)) {
    if (!valores) continue;
    for (const k of SEGREDOS_EXCLUSIVOS) {
      if (tem(k) && env[k] === valores[k]) {
        erros.push(`${k} é igual ao de ${outro} — gere um novo para ${nome}`);
      }
    }
    if (publicado) {
      for (const k of SEGREDOS_RECOMENDADO_SEPARAR) {
        if (tem(k) && env[k] === valores[k]) {
          avisos.push(
            `${k} é igual ao de ${outro} — funciona, mas separar permite ` +
              'revogar um ambiente sem derrubar o outro',
          );
        }
      }
    }
  }

  if (!publicado) return mascarar({ erros, avisos }, env);

  // 4. Endereços de ambiente publicado.
  if (tem('DATABASE_URL') && !nomeDoBanco(env.DATABASE_URL)) {
    erros.push(
      'DATABASE_URL sem nome de banco (…mongodb.net/<banco>?…) — o Atlas ' +
        'recusa com "empty database name not allowed"',
    );
  }
  const bancoHost = hostDoBanco(env.DATABASE_URL);
  if (bancoHost && /localhost|127\.0\.0\.1/.test(bancoHost)) {
    erros.push('DATABASE_URL aponta para localhost');
  }
  if (tem('REDIS_URL') && /localhost|127\.0\.0\.1/.test(env.REDIS_URL)) {
    erros.push('REDIS_URL aponta para localhost');
  }

  for (const k of [
    'FRONTEND_BASE_URL',
    'GOOGLE_OAUTH_REDIRECT_URI',
    'FRONT_REVALIDATE_URL',
  ]) {
    if (!tem(k)) continue;
    if (!env[k].startsWith('https://')) erros.push(`${k} precisa ser https://`);
    if (/localhost|127\.0\.0\.1/.test(env[k])) {
      erros.push(`${k} aponta para localhost`);
    }
  }

  const origens = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  if (origens.some((o) => /localhost|127\.0\.0\.1/.test(o))) {
    erros.push('ALLOWED_ORIGINS inclui localhost');
  }
  const front = env.FRONTEND_BASE_URL?.replace(/\/$/, '');
  if (front && origens.length > 0 && !origens.includes(front)) {
    erros.push(
      'ALLOWED_ORIGINS não inclui o FRONTEND_BASE_URL — o front seria ' +
        'recusado pelo CORS',
    );
  }

  const frontHost = host(env.FRONTEND_BASE_URL);
  const dominio = env.AUTH_COOKIE_DOMAIN?.trim();
  if (!dominio) {
    avisos.push(
      'AUTH_COOKIE_DOMAIN vazio — o cookie fica só no host da API e o ' +
        'middleware do front não o enxerga',
    );
  } else if (frontHost) {
    const raiz = dominio.replace(/^\./, '');
    if (frontHost !== raiz && !frontHost.endsWith(`.${raiz}`)) {
      erros.push(
        'AUTH_COOKIE_DOMAIN não cobre o host do FRONTEND_BASE_URL — o ' +
          'navegador recusaria o cookie',
      );
    }
  }

  const retorno = env.GOOGLE_OAUTH_REDIRECT_URI;
  if (retorno && !retorno.endsWith('/api/auth/google/callback')) {
    erros.push(
      'GOOGLE_OAUTH_REDIRECT_URI deveria terminar em /api/auth/google/callback',
    );
  }

  if (tem('FRONT_REVALIDATE_URL') && frontHost) {
    if (host(env.FRONT_REVALIDATE_URL) !== frontHost) {
      avisos.push('FRONT_REVALIDATE_URL não está no host do FRONTEND_BASE_URL');
    }
    if (!env.FRONT_REVALIDATE_URL.endsWith('/api/revalidate')) {
      erros.push('FRONT_REVALIDATE_URL deveria terminar em /api/revalidate');
    }
  }

  // 5. Específicos de cada ambiente.
  if (nome === 'hml') {
    if (env.AUTH_COOKIE_PREFIX !== 'opus_hml') {
      erros.push(
        'AUTH_COOKIE_PREFIX deveria ser opus_hml — com os nomes de produção, ' +
          'os cookies dos dois ambientes colidem no navegador',
      );
    }
    if (tem('STRIPE_SECRET_KEY') || tem('STRIPE_WEBHOOK_SECRET')) {
      erros.push(
        'homologação tem a chave VIVA do Stripe — remova STRIPE_SECRET_KEY e ' +
          'STRIPE_WEBHOOK_SECRET; ela usa só as _TEST',
      );
    }
    if (
      tem('STRIPE_SECRET_KEY_TEST') &&
      !/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY_TEST)
    ) {
      erros.push(
        'STRIPE_SECRET_KEY_TEST não é uma chave de teste (sk_test_/rk_test_)',
      );
    }
    if (env.QUEUE_ROLE && env.QUEUE_ROLE !== 'all') {
      avisos.push(
        'QUEUE_ROLE diferente de "all" — com um contêiner só no Render, jobs ' +
          'entrariam na fila e nunca rodariam',
      );
    }
  }

  if (nome === 'prd') {
    if (tem('AUTH_COOKIE_PREFIX') && env.AUTH_COOKIE_PREFIX !== 'opus') {
      erros.push(
        'AUTH_COOKIE_PREFIX em produção deveria ficar vazio (ou "opus"): as ' +
          'sessões abertas usam os nomes padrão',
      );
    }
    if (
      tem('STRIPE_SECRET_KEY') &&
      !/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY)
    ) {
      erros.push('STRIPE_SECRET_KEY não é uma chave viva (sk_live_/rk_live_)');
    }
    if (env.SWAGGER_ENABLED === 'true') {
      avisos.push('SWAGGER_ENABLED=true publica o contrato inteiro da API');
    }
    if (!tem('SENTRY_DSN')) {
      avisos.push('SENTRY_DSN vazio — erros de produção só no log');
    }
  }

  // 6. Opcional para subir, quebra no primeiro uso.
  const precosFaltando = PRECOS.filter((k) => !tem(k));
  if (precosFaltando.length > 0) {
    avisos.push(
      `${precosFaltando.length} de 6 preços do Stripe vazios ` +
        `(${precosFaltando.join(', ')}) — o checkout desses planos falha`,
    );
  }
  if (!tem('EMAIL_WEBHOOK_SECRET')) {
    avisos.push(
      'EMAIL_WEBHOOK_SECRET vazio — sem o webhook do Resend, entrega, ' +
        'retorno e spam das campanhas não são registrados',
    );
  }
  if (!tem('EMAIL_FROM')) {
    avisos.push('EMAIL_FROM vazio — o remetente cai no padrão do código');
  }
  if (/gmail\.com$/i.test(env.SMTP_HOST ?? '') && env.EMAIL_FROM) {
    const remetente = env.EMAIL_FROM.match(/@([^>\s]+)/)?.[1];
    if (remetente && !/gmail\.com$/i.test(remetente)) {
      avisos.push(
        'SMTP do Gmail com remetente de outro domínio — o Gmail reescreve o ' +
          'remetente e a mensagem tende ao spam. Use o Resend com o domínio ' +
          'verificado',
      );
    }
  }

  const r2 = [
    'BACKUP_R2_ACCOUNT_ID',
    'BACKUP_R2_ACCESS_KEY_ID',
    'BACKUP_R2_SECRET_ACCESS_KEY',
    'BACKUP_R2_BUCKET',
  ];
  const r2Preenchidas = r2.filter(tem).length;
  if (r2Preenchidas > 0 && r2Preenchidas < 4) {
    erros.push(
      `backup R2 pela metade: ${r2.filter((k) => !tem(k)).join(', ')}`,
    );
  } else if (r2Preenchidas === 0) {
    avisos.push('backup R2 não configurado — a tarefa de backup recusa rodar');
  }

  const credencialTts = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credencialTts) {
    avisos.push(
      'GOOGLE_APPLICATION_CREDENTIALS vazio — o áudio dos artigos do blog ' +
        '(texto para voz) fica desligado',
    );
  }

  return mascarar({ erros, avisos }, env);
}

/**
 * Rede de segurança do "nunca imprime valor": algumas mensagens do Joi citam o
 * valor recebido (`with value "..."`). Qualquer trecho da saída igual a um
 * valor do arquivo vira `***`.
 */
function mascarar(relatorio: Relatorio, env: Env): Relatorio {
  const valores = Object.values(env)
    .map((v) => v.trim())
    .filter((v) => v.length >= 6)
    .sort((a, b) => b.length - a.length);

  const limpar = (linha: string) =>
    valores.reduce((acc, v) => acc.split(v).join('***'), linha);

  return {
    erros: relatorio.erros.map(limpar),
    avisos: relatorio.avisos.map(limpar),
  };
}

function ler(nome: AppEnv): Env | undefined {
  const caminho = resolve(process.cwd(), `.env.${nome}`);
  return existsSync(caminho) ? parse(readFileSync(caminho)) : undefined;
}

function main(): void {
  const nome = process.argv[2] as AppEnv;

  if (!(APP_ENVS as readonly string[]).includes(nome)) {
    console.error(
      `Diga qual ambiente: npm run env:check -- ${APP_ENVS.join('|')}`,
    );
    process.exit(2);
  }

  const env = ler(nome);
  if (!env) {
    console.error(
      `Não existe .env.${nome}. Copie de .env.${nome}.example e preencha.`,
    );
    process.exit(2);
  }

  const outros = Object.fromEntries(
    APP_ENVS.filter((n) => n !== nome).map((n) => [n, ler(n)]),
  ) as Partial<Record<AppEnv, Env>>;

  const { erros, avisos } = conferirAmbiente(nome, env, outros);

  console.log(`\n.env.${nome}\n`);
  for (const e of erros) console.log(`  ✗ ${e}`);
  for (const a of avisos) console.log(`  ! ${a}`);

  if (erros.length === 0) {
    console.log(
      `\n  ✓ nenhum erro${avisos.length ? ` (${avisos.length} aviso(s))` : ''}`,
    );
  } else {
    console.log(`\n  ${erros.length} erro(s), ${avisos.length} aviso(s)`);
  }

  process.exit(erros.length > 0 ? 1 : 0);
}

if (require.main === module) main();
