import { BadRequestException } from '@nestjs/common';

/**
 * Fontes externas de onde a plataforma aceita raspar catálogo.
 *
 * A chave é o identificador que a rota recebe; `hosts` é a lista fechada de
 * domínios aceitos, comparada contra o **host** da URL.
 */
export const EXTERNAL_SOURCES = {
  imslp: {
    label: 'IMSLP',
    hosts: ['imslp.org', 'www.imslp.org'],
  },
  wikipedia: {
    label: 'Wikipedia',
    // Wikipedia tem um host por idioma. O sufixo é conferido separadamente.
    hosts: [],
    hostSuffix: '.wikipedia.org',
  },
  // O Wikidata é a fonte estruturada por trás dos artigos: é de lá que saem as
  // datas com precisão e calendário declarados, em vez de lidas da prosa.
  wikidata: {
    label: 'Wikidata',
    hosts: ['www.wikidata.org', 'wikidata.org'],
  },
} as const;

export type ExternalSource = keyof typeof EXTERNAL_SOURCES;

export function isExternalSource(value: string): value is ExternalSource {
  return value === 'imslp' || value === 'wikipedia' || value === 'wikidata';
}

/**
 * Valida a URL de origem antes de o servidor buscá-la.
 *
 * **Isto é a correção de um SSRF sem autenticação.**
 * `POST /uploads/external-sources/scraper` do legado **não tinha checagem de
 * sessão nenhuma** — nem papel, nem login — e decidia se a URL era confiável
 * com `url.includes('imslp.org')`. Um `includes` sobre a URL **inteira**, não
 * sobre o host. Todas estas passavam:
 *
 * ```
 * http://169.254.169.254/latest/meta-data/?x=imslp.org
 * http://servidor-interno:8080/admin#imslp.org
 * http://imslp.org.dominio-do-atacante.com/
 * http://dominio-do-atacante.com/imslp.org
 * ```
 *
 * Qualquer pessoa na internet podia fazer o servidor buscar um endereço
 * interno — metadados da nuvem, painel administrativo em rede privada, banco
 * exposto na VPC — e **receber o conteúdo de volta**, já parseado, na resposta
 * da requisição.
 *
 * Aqui a URL é aberta de verdade, o esquema precisa ser HTTPS e o **host** é
 * comparado com uma lista fechada. Endereço com credencial embutida
 * (`https://user:senha@imslp.org`) também é recusado: ele engana a leitura
 * humana e não tem uso legítimo aqui.
 */
export function requireSourceUrl(
  rawUrl: string,
  expected?: ExternalSource,
): { url: string; source: ExternalSource } {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BadRequestException(`URL inválida: "${rawUrl}".`);
  }

  if (parsed.protocol !== 'https:') {
    throw new BadRequestException(
      'Apenas endereços HTTPS são aceitos como fonte externa.',
    );
  }

  if (parsed.username || parsed.password) {
    throw new BadRequestException(
      'Endereço com credencial embutida não é aceito.',
    );
  }

  const host = parsed.hostname.toLowerCase();
  const source = detectSource(host);

  if (!source) {
    throw new BadRequestException(
      `Fonte não suportada: "${host}". Aceitos: ${Object.values(
        EXTERNAL_SOURCES,
      )
        .map((source) => source.label)
        .join(', ')}.`,
    );
  }

  if (expected && expected !== source) {
    throw new BadRequestException(
      `O endereço é de ${EXTERNAL_SOURCES[source].label}, mas a fonte informada foi ${EXTERNAL_SOURCES[expected].label}.`,
    );
  }

  // Devolve a URL normalizada pelo próprio parser, não a string recebida: é
  // ela que vai para o cliente HTTP, e assim não há como o que foi validado
  // ser diferente do que é buscado.
  return { url: parsed.toString(), source };
}

function detectSource(host: string): ExternalSource | null {
  if ((EXTERNAL_SOURCES.imslp.hosts as readonly string[]).includes(host)) {
    return 'imslp';
  }

  if ((EXTERNAL_SOURCES.wikidata.hosts as readonly string[]).includes(host)) {
    return 'wikidata';
  }

  if (
    host === 'wikipedia.org' ||
    host.endsWith(EXTERNAL_SOURCES.wikipedia.hostSuffix)
  ) {
    return 'wikipedia';
  }

  return null;
}
