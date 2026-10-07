/**
 * Robôs conhecidos pelo `User-Agent` — buscadores, prévias de link, SEO,
 * coletores de IA e navegadores sem cabeça.
 *
 * Não é segurança (o cabeçalho é declarado por quem pede): é para não gastar
 * trabalho caro com quem declara ser robô. O Googlebot, por exemplo, executa o
 * JavaScript da página da obra e chamaria a raspagem do IMSLP a cada obra
 * que visita. Pedido sem `User-Agent` também conta: navegador sempre manda.
 */
const ROBOT_PATTERN = new RegExp(
  [
    'bot\\b',
    'bot[/;)]',
    'crawler',
    'spider',
    'slurp',
    'crawl',
    'googlebot',
    'google-inspectiontool',
    'adsbot',
    'mediapartners',
    'bingpreview',
    'facebookexternalhit',
    'meta-externalagent',
    'whatsapp',
    'telegrambot',
    'embedly',
    'quora link preview',
    'outbrain',
    'pinterest',
    'vkshare',
    'ahrefs',
    'semrush',
    'mj12',
    'dotbot',
    'petalbot',
    'bytespider',
    'gptbot',
    'chatgpt-user',
    'oai-searchbot',
    'claudebot',
    'claude-web',
    'anthropic-ai',
    'perplexity',
    'ccbot',
    'cohere-ai',
    'diffbot',
    'headlesschrome',
    'phantomjs',
    'lighthouse',
    'chrome-lighthouse',
    'python-requests',
    'python-urllib',
    'aiohttp',
    'httpx',
    'curl/',
    'wget/',
    'go-http-client',
    'java/',
    'okhttp',
    'axios/',
    'node-fetch',
    'scrapy',
  ].join('|'),
  'i',
);

export function isRobotUserAgent(
  userAgent: string | undefined | null,
): boolean {
  if (!userAgent || !userAgent.trim()) return true;
  return ROBOT_PATTERN.test(userAgent);
}
