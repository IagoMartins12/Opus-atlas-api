import { Prisma } from '@prisma/client';
import {
  NON_COUNTRY,
  demonymOf,
  pickCountryId,
  yearOfWikidataTime,
  type WikidataClaim,
} from '../quality/nationality';
import { chunks, sleep, type CatalogJobWork } from './job-types';

/**
 * Preenche e corrige a nacionalidade dos compositores pelo Wikidata, a partir
 * do artigo da Wikipédia já raspado. O link da raspagem nem sempre é do
 * compositor (categoria, outro "Albert"), então só vale quando o item é gente,
 * compositor e, havendo ano de nascimento nos dois lados, o ano confere
 * (±1). Preenche quem está sem nacionalidade; troca continente ("European")
 * e o "American" da raspagem, que é o erro mais comum.
 * O resto que discorda vai para o relatório, sem gravar.
 *
 *   node dist/scripts/fix-composer-nationalities.js           # simula
 *   node dist/scripts/fix-composer-nationalities.js --apply   # grava
 *   ... --limit=300   # só os primeiros N, para teste
 */
const UA = 'OpusAtlas/1.0 (martinsiagosaraiva@gmail.com)';
const COMPOSER = 'Q36834';
const HUMAN = 'Q5';
const AMERICAS = new Set([
  'Brazilian',
  'Canadian',
  'Mexican',
  'Argentine',
  'Chilean',
  'Cuban',
  'Venezuelan',
  'Colombian',
  'Peruvian',
  'Uruguayan',
]);

async function getJson<T>(url: string): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return (await res.json()) as T;
    if (res.status === 429 || res.status >= 500) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    throw new Error(`${res.status} em ${url.slice(0, 90)}`);
  }
  throw new Error(`Sem resposta de ${url.slice(0, 90)}`);
}

interface Entity {
  claims?: Record<string, WikidataClaim[]>;
  labels?: { en?: { value: string } };
}

const ids = (c: WikidataClaim[] | undefined) =>
  (c ?? [])
    .map((x) => x.mainsnak?.datavalue?.value?.id)
    .filter((x): x is string => !!x);

export const work: CatalogJobWork = async ({
  prisma,
  apply,
  logger,
  args,
  progress,
  shouldStop,
}) => {
  const limit = Number(args.limit) || undefined;

  const emptyOr = [
    { nationality: null },
    { nationality: '' },
    { nationality: { isSet: false } },
  ] as Prisma.ComposerWhereInput[];
  const candidates = await prisma.composer.findMany({
    where: {
      wikipediaLink: { not: null },
      OR: [
        ...emptyOr,
        { nationality: 'American' },
        {
          nationality: {
            in: ['European', 'Asian', 'African', 'Latin American'],
          },
        },
      ],
    },
    select: {
      id: true,
      name: true,
      nationality: true,
      birthYear: true,
      wikipediaLink: true,
    },
    take: limit,
  });
  logger.log(`${candidates.length} compositor(es) a conferir`);

  // 1) artigo → item do Wikidata
  const byHost = new Map<string, Map<string, string[]>>();
  for (const c of candidates) {
    const m = /^https?:\/\/([a-z-]+)\.wikipedia\.org\/wiki\/([^#?]+)/.exec(
      c.wikipediaLink ?? '',
    );
    if (!m) continue;
    let title: string;
    try {
      title = decodeURIComponent(m[2]).replace(/_/g, ' ');
    } catch {
      continue; // link mal formado na raspagem
    }
    if (title.includes(':')) continue; // Category:, Special:, Talk:…
    const titles = byHost.get(m[1]) ?? new Map<string, string[]>();
    titles.set(title, [...(titles.get(title) ?? []), c.id]);
    byHost.set(m[1], titles);
  }
  const qidOf = new Map<string, string>(); // composer id → Q
  let step = 0;
  for (const [host, titles] of byHost) {
    for (const part of chunks([...titles.keys()], 50)) {
      if (shouldStop()) throw new Error('Parada pedida');
      progress(++step, undefined, 'Artigos da Wikipédia');
      const url = `https://${host}.wikipedia.org/w/api.php?action=query&prop=pageprops&ppprop=wikibase_item&redirects=1&format=json&titles=${encodeURIComponent(part.join('|'))}`;
      const data = await getJson<{
        query?: {
          normalized?: { from: string; to: string }[];
          redirects?: { from: string; to: string }[];
          pages?: Record<
            string,
            { title: string; pageprops?: { wikibase_item?: string } }
          >;
        };
      }>(url);
      const alias = new Map<string, string>();
      for (const n of data.query?.normalized ?? []) alias.set(n.from, n.to);
      const redirect = new Map<string, string>();
      for (const r of data.query?.redirects ?? []) redirect.set(r.from, r.to);
      const qByTitle = new Map<string, string>();
      for (const p of Object.values(data.query?.pages ?? {}))
        if (p.pageprops?.wikibase_item)
          qByTitle.set(p.title, p.pageprops.wikibase_item);
      for (const t of part) {
        const n = alias.get(t) ?? t;
        const q = qByTitle.get(redirect.get(n) ?? n);
        if (q) for (const id of titles.get(t) ?? []) qidOf.set(id, q);
      }
      await sleep(400);
    }
  }
  logger.log(`${qidOf.size} com item no Wikidata`);

  // 2) item → humano, compositor, nascimento, cidadania
  const entities = new Map<string, Entity>();
  const qids = [...new Set(qidOf.values())];
  for (const part of chunks(qids, 50)) {
    if (shouldStop()) throw new Error('Parada pedida');
    progress(++step, undefined, 'Itens do Wikidata');
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&props=claims&format=json&ids=${part.join('|')}`;
    const data = await getJson<{ entities?: Record<string, Entity> }>(url);
    for (const [q, e] of Object.entries(data.entities ?? {}))
      entities.set(q, e);
    await sleep(400);
  }
  // 3) rótulos dos países
  const countryIds = new Set<string>();
  for (const e of entities.values())
    for (const id of pickCountryId(e.claims?.P27)) countryIds.add(id);
  const countryName = new Map<string, string>();
  for (const part of chunks([...countryIds], 50)) {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&props=labels&languages=en&format=json&ids=${part.join('|')}`;
    const data = await getJson<{ entities?: Record<string, Entity> }>(url);
    for (const [q, e] of Object.entries(data.entities ?? {}))
      if (e.labels?.en?.value) countryName.set(q, e.labels.en.value);
    await sleep(400);
  }

  const rejected: Record<string, number> = {};
  const reject = (why: string) => (rejected[why] = (rejected[why] ?? 0) + 1);
  const fill: { id: string; name: string; to: string }[] = [];
  const swap: { id: string; name: string; from: string; to: string }[] = [];
  const disagree: string[] = [];
  const unmapped = new Map<string, number>();

  for (const c of candidates) {
    const q = qidOf.get(c.id);
    const e = q ? entities.get(q) : undefined;
    if (!e) {
      reject('sem item no Wikidata');
      continue;
    }
    if (!ids(e.claims?.P31).includes(HUMAN)) {
      reject('o item não é uma pessoa');
      continue;
    }
    if (!ids(e.claims?.P106).includes(COMPOSER)) {
      reject('o item não é de compositor');
      continue;
    }
    const born = yearOfWikidataTime(
      e.claims?.P569?.[0]?.mainsnak?.datavalue?.value?.time,
    );
    if (c.birthYear && born && Math.abs(c.birthYear - born) > 1) {
      reject('ano de nascimento não confere');
      continue;
    }
    const countries = [
      ...new Set(
        pickCountryId(e.claims?.P27).map((id) => countryName.get(id) ?? '?'),
      ),
    ];
    const demonyms = [
      ...new Set(
        countries.map((n) => {
          const d = demonymOf(n);
          if (!d && n !== '?') unmapped.set(n, (unmapped.get(n) ?? 0) + 1);
          return d;
        }),
      ),
    ];
    if (demonyms.length !== 1 || !demonyms[0]) {
      reject(
        demonyms.length > 1 ? 'mais de uma cidadania' : 'país sem gentílico',
      );
      continue;
    }
    const to = demonyms[0];
    const cur = (c.nationality ?? '').trim();
    if (!cur) fill.push({ id: c.id, name: c.name, to });
    else if (cur === to) reject('já está certo');
    else if (
      NON_COUNTRY.has(cur.toLowerCase()) ||
      // "American" é o valor errado mais comum da raspagem; fora das Américas
      // só se troca com o ano de nascimento conferido nos dois lados.
      (cur === 'American' && (AMERICAS.has(to) || (c.birthYear && born)))
    )
      swap.push({ id: c.id, name: c.name, from: cur, to });
    else disagree.push(`${c.name}: ${cur} → Wikidata diz ${to}`);
  }

  logger.log(`Preenchem: ${fill.length}`);
  logger.log(
    `e.g. ${fill
      .slice(0, 8)
      .map((f) => `${f.name} ${f.to}`)
      .join('; ')}`,
  );
  logger.log(`Trocam: ${swap.length}`);
  for (const s of swap.slice(0, 15))
    logger.log(`  ${s.name}: ${s.from} → ${s.to}`);
  logger.log(`Discordam (só relatório): ${disagree.length}`);
  for (const d of disagree.slice(0, 15)) logger.log(`  ${d}`);
  logger.log(`Descartados: ${JSON.stringify(rejected)}`);
  if (unmapped.size)
    logger.log(
      `Países sem gentílico: ${[...unmapped].map(([n, k]) => `${n} (${k})`).join(', ')}`,
    );
  const outcome = {
    summary: {
      preenchem: fill.length,
      trocam: swap.length,
      discordam: disagree.length,
      conferidos: candidates.length,
    },
    sample: [
      ...fill.slice(0, 8).map((f) => `${f.name}: ${f.to}`),
      ...swap.slice(0, 8).map((s) => `${s.name}: ${s.from} → ${s.to}`),
    ],
    warnings: disagree.slice(0, 15),
  };
  if (!apply) return outcome;

  const byValue = new Map<string, string[]>();
  for (const x of [...fill, ...swap])
    byValue.set(x.to, [...(byValue.get(x.to) ?? []), x.id]);
  for (const [nationality, list] of byValue)
    for (const part of chunks(list))
      await prisma.composer.updateMany({
        where: { id: { in: part } },
        data: { nationality },
      });
  logger.log(`Gravado: ${fill.length + swap.length} compositor(es)`);
  return outcome;
};
