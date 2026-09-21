/**
 * Os textos enviados à IA para a biografia de compositor.
 *
 * Diferenças para o prompt do legado:
 *
 * - **O modelo recebe tudo o que o catálogo sabe** (nomes alternativos,
 *   nacionalidade, instrumentos), não só nome e datas. Dos 19 mil compositores,
 *   a maioria é obscura; mais contexto é menos confusão com homônimos.
 * - **Sem link da Wikipédia.** O legado pedia ao modelo que colocasse um — e
 *   modelo inventa URL. O catálogo já tem `wikipediaLink`, quando existe.
 * - **"Não sei" tem forma fixa** (`SEM_BIOGRAFIA`), em vez de uma frase que o
 *   legado depois comparava por tamanho. Compositor que o modelo não conhece
 *   não recebe biografia inventada.
 * - **Texto corrido, sem markdown**: o front mostra a biografia em parágrafos.
 */

/** Resposta do modelo quando não conhece o compositor com segurança. */
export const NO_BIO_MARKER = 'SEM_BIOGRAFIA';

/** Abaixo disto não é biografia — nem a do banco, nem a gerada. */
export const MIN_BIO_CHARS = 50;

export interface BioSubject {
  name: string;
  fullName: string;
  alternativeNames?: string | null;
  birthDate?: string | null;
  deathDate?: string | null;
  epochName?: string | null;
  roleName?: string | null;
  nationality?: string | null;
  instruments?: string | null;
}

export const BIO_SYSTEM = [
  'Você é musicólogo e escreve verbetes para uma enciclopédia de música clássica, em português do Brasil.',
  'Só afirma o que é fato histórico verificável; na dúvida, omite.',
  'Nunca inventa obras, datas, professores ou episódios.',
].join(' ');

const known = (value?: string | null): string | null => {
  const text = value?.trim();
  return text && text.toLowerCase() !== 'desconhecido' ? text : null;
};

export function bioPrompt(subject: BioSubject): string {
  const name = known(subject.fullName) ?? subject.name.trim();
  const facts = [
    ['Nome no catálogo', known(subject.name)],
    ['Outros nomes', known(subject.alternativeNames)],
    ['Nascimento', known(subject.birthDate)],
    ['Morte', known(subject.deathDate)],
    ['Período', known(subject.epochName)],
    ['Atuação principal', known(subject.roleName)],
    ['Nacionalidade', known(subject.nationality)],
    ['Instrumentos', known(subject.instruments)],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `- ${label}: ${value}`);

  return [
    `Escreva a biografia de ${name}.`,
    '',
    'O que o catálogo sabe dessa pessoa:',
    ...(facts.length > 0 ? facts : ['- (nada além do nome)']),
    '',
    'A biografia deve cobrir, quando houver informação confiável:',
    '1. nascimento, morte e nacionalidade;',
    '2. formação musical e influências;',
    '3. características do estilo;',
    '4. principais obras e contribuições;',
    '5. contexto histórico e importância;',
    '6. um aspecto marcante da vida pessoal.',
    '',
    'Forma:',
    '- até 2.500 caracteres, em 3 a 5 parágrafos separados por uma linha em branco;',
    '- texto corrido, sem título, sem listas, sem markdown, sem links;',
    '- tom de enciclopédia, sem mencionar que é um texto gerado, sem "em resumo".',
    '',
    `Se você não tem informação confiável sobre esta pessoa, ou se os dados acima parecem ser de outra, responda apenas ${NO_BIO_MARKER}.`,
  ].join('\n');
}

export const TRANSLATION_SYSTEM = [
  'You translate Brazilian Portuguese encyclopedia entries about classical music into English.',
  'Translate faithfully: do not add, remove or correct facts.',
  'Keep the paragraph breaks. Answer with the translation only.',
].join(' ');

export function translationPrompt(text: string): string {
  return text;
}

/**
 * O texto que sai do modelo, pronto para gravar — ou `null` quando ele disse
 * que não sabe, ou devolveu algo curto demais para ser biografia.
 */
export function cleanBio(raw: string): string | null {
  if (raw.toUpperCase().includes(NO_BIO_MARKER)) return null;

  const text = raw
    .replace(/\r\n/g, '\n')
    // Título que o modelo acrescente mesmo pedido que não.
    .replace(/^\s*#+\s.*\n+/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text.length >= MIN_BIO_CHARS ? text : null;
}

export function hasBio(value?: string | null): value is string {
  return (value?.trim().length ?? 0) >= MIN_BIO_CHARS;
}
