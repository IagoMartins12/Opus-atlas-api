/** As épocas, pelo ano de nascimento. Faixas herdadas do legado. */
const EPOCHS: { until: number; name: string }[] = [
  { until: 1399, name: 'Medieval' },
  { until: 1599, name: 'Renascentista' },
  { until: 1749, name: 'Barroco' },
  { until: 1819, name: 'Clássico' },
  { until: 1910, name: 'Romântico' },
  { until: 1949, name: 'Modernismo' },
];

/** Quando não há ano de nascimento. */
export const DEFAULT_EPOCH = 'Contemporâneo';

/**
 * A época pelo ano de nascimento.
 *
 * **É um palpite, e o nome do campo não diz isso.** Um compositor nascido em
 * 1745 entra como "Clássico" mesmo tendo escrito obra barroca a vida toda, e
 * Villa-Lobos, nascido em 1887, cai em "Romântico" enquanto o catálogo o tem
 * como "Modernismo". As faixas ficaram como no legado de propósito: mudá-las
 * faria a sugestão divergir das 19.177 fichas já classificadas por elas. A
 * época sugerida serve para quem revisa não começar do zero; quem confirma é
 * gente, na verificação do compositor.
 *
 * É a mesma função para as duas fontes — IMSLP e Wikipedia —, porque uma
 * segunda cópia é como o parser do IMSLP acabou divergindo em seis de nove
 * funções entre duas rotas.
 */
export function epochByBirthYear(birthDate: string | null): string {
  const year = Number(birthDate?.match(/(\d{4})/)?.[1]);

  if (!year) {
    return DEFAULT_EPOCH;
  }

  return EPOCHS.find((epoch) => year <= epoch.until)?.name ?? DEFAULT_EPOCH;
}

/**
 * O sobrenome, que é o que o catálogo guarda em `Composer.name`.
 *
 * O legado chamava isto de `extractFirstName` e devolvia o **último** pedaço do
 * nome. O nome da função estava errado e o comportamento, certo: o catálogo tem
 * `name: "Bach"` para `fullName: "Johann Sebastian Bach"`.
 */
export function surnameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);

  return parts[parts.length - 1] ?? fullName;
}
