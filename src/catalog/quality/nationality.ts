/**
 * Nacionalidade pelo Wikidata (P27, cidadania). O cadastro guarda o gentílico
 * em inglês ("German"); o Wikidata devolve o país, às vezes um Estado que já
 * não existe. Aqui o país vira gentílico, nunca continente, e só vale quando
 * a escolha é inequívoca.
 */

const DEMONYM: Record<string, string> = {
  Germany: 'German',
  'German Empire': 'German',
  'Kingdom of Prussia': 'German',
  Prussia: 'German',
  'Kingdom of Saxony': 'German',
  'Kingdom of Bavaria': 'German',
  'Kingdom of Hanover': 'German',
  'Kingdom of Württemberg': 'German',
  'Weimar Republic': 'German',
  'Nazi Germany': 'German',
  'East Germany': 'German',
  'West Germany': 'German',
  'Electorate of Saxony': 'German',
  'Holy Roman Empire': 'German',
  Austria: 'Austrian',
  'Austrian Empire': 'Austrian',
  'Archduchy of Austria': 'Austrian',
  'Habsburg monarchy': 'Austrian',
  'Austria-Hungary': 'Austrian',
  'Austria–Hungary': 'Austrian',
  Cisleithania: 'Austrian',
  Monaco: 'Monegasque',
  Philippines: 'Filipino',
  Paraguay: 'Paraguayan',
  'German Reich': 'German',
  'Kingdom of Denmark': 'Danish',
  "Ukrainian People's Republic": 'Ukrainian',
  "West Ukrainian People's Republic": 'Ukrainian',
  'Ukrainian Soviet Socialist Republic': 'Ukrainian',
  Taiwan: 'Taiwanese',
  Ecuador: 'Ecuadorian',
  Haiti: 'Haitian',
  'Azerbaijan Democratic Republic': 'Azerbaijani',
  France: 'French',
  'Kingdom of France': 'French',
  'First French Empire': 'French',
  'French Second Republic': 'French',
  'French Third Republic': 'French',
  Italy: 'Italian',
  'Kingdom of Italy': 'Italian',
  'Republic of Venice': 'Italian',
  'Kingdom of Naples': 'Italian',
  'Kingdom of Sardinia': 'Italian',
  'Papal States': 'Italian',
  'Grand Duchy of Tuscany': 'Italian',
  'Republic of Genoa': 'Italian',
  'Kingdom of the Two Sicilies': 'Italian',
  'United Kingdom': 'English',
  England: 'English',
  'Kingdom of England': 'English',
  'Kingdom of Great Britain': 'English',
  'United Kingdom of Great Britain and Ireland': 'English',
  Scotland: 'Scottish',
  Wales: 'Welsh',
  Ireland: 'Irish',
  'Kingdom of Ireland': 'Irish',
  Russia: 'Russian',
  'Russian Empire': 'Russian',
  'Soviet Union': 'Russian',
  'Tsardom of Russia': 'Russian',
  Poland: 'Polish',
  'Second Polish Republic': 'Polish',
  'Duchy of Warsaw': 'Polish',
  'Congress Poland': 'Polish',
  'Polish–Lithuanian Commonwealth': 'Polish',
  'Kingdom of Poland': 'Polish',
  Spain: 'Spanish',
  'Spanish Empire': 'Spanish',
  'Kingdom of Castile': 'Spanish',
  'Crown of Aragon': 'Spanish',
  'Kingdom of Spain': 'Spanish',
  Portugal: 'Portuguese',
  'Kingdom of Portugal': 'Portuguese',
  Brazil: 'Brazilian',
  'Empire of Brazil': 'Brazilian',
  'United States': 'American',
  'United States of America': 'American',
  Canada: 'Canadian',
  Mexico: 'Mexican',
  Argentina: 'Argentine',
  Chile: 'Chilean',
  Cuba: 'Cuban',
  Venezuela: 'Venezuelan',
  Colombia: 'Colombian',
  Peru: 'Peruvian',
  Uruguay: 'Uruguayan',
  Belgium: 'Belgian',
  'United Kingdom of the Netherlands': 'Dutch',
  Netherlands: 'Dutch',
  'Dutch Republic': 'Dutch',
  'Kingdom of the Netherlands': 'Dutch',
  Denmark: 'Danish',
  'Denmark–Norway': 'Danish',
  Sweden: 'Swedish',
  Norway: 'Norwegian',
  Finland: 'Finnish',
  'Grand Duchy of Finland': 'Finnish',
  Iceland: 'Icelandic',
  Switzerland: 'Swiss',
  'Czech Republic': 'Czech',
  Czechoslovakia: 'Czech',
  'Kingdom of Bohemia': 'Czech',
  Bohemia: 'Czech',
  Slovakia: 'Slovak',
  Hungary: 'Hungarian',
  'Kingdom of Hungary': 'Hungarian',
  Romania: 'Romanian',
  Bulgaria: 'Bulgarian',
  Serbia: 'Serbian',
  Croatia: 'Croatian',
  Slovenia: 'Slovene',
  Greece: 'Greek',
  Turkey: 'Turkish',
  'Ottoman Empire': 'Turkish',
  Ukraine: 'Ukrainian',
  Lithuania: 'Lithuanian',
  Latvia: 'Latvian',
  Estonia: 'Estonian',
  Georgia: 'Georgian',
  Armenia: 'Armenian',
  Azerbaijan: 'Azerbaijani',
  Israel: 'Israeli',
  Japan: 'Japanese',
  China: 'Chinese',
  "People's Republic of China": 'Chinese',
  'South Korea': 'Korean',
  India: 'Indian',
  Australia: 'Australian',
  'New Zealand': 'New Zealander',
  'South Africa': 'South African',
  Luxembourg: 'Luxembourgish',
  Malta: 'Maltese',
  Cyprus: 'Cypriot',
  Egypt: 'Egyptian',
};

/** O gentílico de um país (ou Estado histórico) do Wikidata; `null` se não mapeado. */
export function demonymOf(country: string): string | null {
  return DEMONYM[country] ?? null;
}

/** Valores que são continente ou região, não país: sempre trocáveis. */
export const NON_COUNTRY = new Set([
  'european',
  'asian',
  'african',
  'latin american',
  'south american',
  'north american',
]);

export interface WikidataClaim {
  rank?: 'preferred' | 'normal' | 'deprecated';
  mainsnak?: { datavalue?: { value?: { id?: string; time?: string } } };
  qualifiers?: Record<string, unknown>;
}

/**
 * Escolhe o país entre as cidadanias: ignora as depreciadas e as já
 * encerradas (P582), prefere as de rank preferido. Duas nacionalidades
 * distintas sem preferida = ambíguo = `null`.
 */
export function pickCountryId(claims: WikidataClaim[] | undefined) {
  const alive = (claims ?? []).filter(
    (c) => c.rank !== 'deprecated' && c.mainsnak?.datavalue?.value?.id,
  );
  const open = alive.filter((c) => !c.qualifiers?.P582);
  const pool = open.length ? open : alive;
  const preferred = pool.filter((c) => c.rank === 'preferred');
  const final = preferred.length ? preferred : pool;
  return final.map((c) => c.mainsnak!.datavalue!.value!.id!);
}

/** "+1770-12-17T00:00:00Z" → 1770. */
export function yearOfWikidataTime(time: string | undefined): number | null {
  const m = /^[+-](\d{1,4})-/.exec(time ?? '');
  return m ? Number(m[1]) : null;
}
