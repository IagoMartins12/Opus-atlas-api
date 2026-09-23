import { PlanType, PrismaClient } from '@prisma/client';
import { errorMessage } from '../common/utils/error.util';
import { TRIAL_PERIOD_DAYS } from '../billing/constants/plan-features.constants';

/**
 * Semeia `plan_pricing` — a tabela de preços que a página `/pricing` lê.
 *
 * **Por que este script existe.** A coleção estava vazia em homologação, e o
 * recorte não tinha como ajudar: ele copia `plan_pricing` inteira, e a origem
 * também estava vazia. Com ela vazia, `GET /api/pricing` responde
 * `{"data":{}}` e o front cai nos valores fixos de `subscriptionConstants.ts`
 * — ou seja, **a página mostra preço mesmo sem banco**, e ninguém percebe que
 * a fonte de verdade não existe. O checkout, esse sim, para: ele calcula o
 * valor pelo banco e responde 404 ("Preço não configurado").
 *
 * **O preço mora em dois lugares e os dois têm de concordar:** aqui (o que o
 * site exibe) e no painel do Stripe (o que é de fato cobrado). Não há
 * validação cruzada — se divergirem, o site anuncia um valor e a fatura vem
 * com outro. Ao mudar um, mude o outro.
 *
 * **Idempotente:** reexecutar atualiza a linha existente de cada plano, sem
 * duplicar. Com `--forcar` sobrescreve valores já alterados pelo painel de
 * admin; sem ele, uma linha já existente só é atualizada se ainda estiver com
 * os valores deste arquivo.
 *
 * Uso:  APP_ENV=hml node --env-file=.env.hml dist/scripts/seed-plan-pricing.js
 *       … --forcar
 */

export interface Plano {
  planType: PlanType;
  monthlyPrice: number;
  quarterlyPrice: number;
  biannualPrice: number;
  yearlyPrice: number;
  displayOrder: number;
  description: string;
}

/**
 * A régua é a mesma nos três planos: o anual sai por dez meses (~16% de
 * desconto). Trimestral e semestral seguem os 10% e 15% históricos,
 * arredondados para terminar em `,90`.
 *
 * **Trimestral e semestral aparecem na resposta da API mas não são vendáveis:**
 * o front só oferece mensal e anual, e só esses dois têm ID de preço no
 * Stripe. Estão preenchidos para que a API não devolva `R$ 0,00` neles.
 */
export const PLANOS: Plano[] = [
  {
    planType: 'PLUS',
    monthlyPrice: 19.9,
    quarterlyPrice: 53.9,
    biannualPrice: 101.9,
    yearlyPrice: 199.9,
    displayOrder: 1,
    description: 'Para alunos dedicados que querem acelerar sua evolução',
  },
  {
    planType: 'MENTOR',
    monthlyPrice: 39.9,
    quarterlyPrice: 107.9,
    biannualPrice: 203.9,
    yearlyPrice: 399.9,
    displayOrder: 2,
    description: 'Para professores iniciantes que querem organizar suas aulas',
  },
  {
    planType: 'MAESTRO',
    monthlyPrice: 79.9,
    quarterlyPrice: 215.9,
    biannualPrice: 407.9,
    yearlyPrice: 799.9,
    displayOrder: 3,
    description: 'Para professores profissionais com alunos ilimitados',
  },
];

/** Desconto em % de um período, derivado dos preços — nunca digitado à mão. */
export function desconto(mensal: number, preco: number, meses: number): number {
  const cheio = mensal * meses;
  return Math.round((1 - preco / cheio) * 1000) / 10;
}

function reais(valor: number): string {
  return valor.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

async function semear(forcar: boolean): Promise<void> {
  const prisma = new PrismaClient();

  try {
    for (const plano of PLANOS) {
      const dados = {
        planType: plano.planType,
        monthlyPrice: plano.monthlyPrice,
        quarterlyPrice: plano.quarterlyPrice,
        biannualPrice: plano.biannualPrice,
        yearlyPrice: plano.yearlyPrice,
        quarterlyDiscount: desconto(
          plano.monthlyPrice,
          plano.quarterlyPrice,
          3,
        ),
        biannualDiscount: desconto(plano.monthlyPrice, plano.biannualPrice, 6),
        yearlyDiscount: desconto(plano.monthlyPrice, plano.yearlyPrice, 12),
        trialDays: TRIAL_PERIOD_DAYS[plano.planType],
        isActive: true,
        description: plano.description,
        displayOrder: plano.displayOrder,
      };

      const existente = await prisma.planPricing.findFirst({
        where: { planType: plano.planType },
      });

      if (!existente) {
        await prisma.planPricing.create({ data: dados });
        console.log(
          `  criado   ${plano.planType.padEnd(8)} ${reais(plano.monthlyPrice)}/mês · ` +
            `${reais(plano.yearlyPrice)}/ano (${dados.yearlyDiscount}% off)`,
        );
        continue;
      }

      const mudou =
        existente.monthlyPrice !== plano.monthlyPrice ||
        existente.yearlyPrice !== plano.yearlyPrice;

      if (mudou && !forcar) {
        console.log(
          `  MANTIDO  ${plano.planType.padEnd(8)} já está ${reais(existente.monthlyPrice)}/mês · ` +
            `${reais(existente.yearlyPrice ?? 0)}/ano — use --forcar para sobrescrever`,
        );
        continue;
      }

      await prisma.planPricing.update({
        where: { id: existente.id },
        data: dados,
      });
      console.log(
        `  ajustado ${plano.planType.padEnd(8)} ${reais(plano.monthlyPrice)}/mês · ` +
          `${reais(plano.yearlyPrice)}/ano (${dados.yearlyDiscount}% off)`,
      );
    }

    const ativos = await prisma.planPricing.count({
      where: { isActive: true },
    });
    console.log(`\n${ativos} plano(s) ativo(s) em plan_pricing.`);
    console.log(
      'Confira que os preços do Stripe (STRIPE_PRICE_*) batem com estes:\n' +
        'o site exibe o valor daqui, mas quem cobra é o Stripe.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const forcar = process.argv.includes('--forcar');

  const url = process.env.DATABASE_URL ?? '';
  const banco = url.split('/').pop()?.split('?')[0] ?? '(sem nome)';
  console.log(`Semeando preços no banco "${banco}".\n`);

  await semear(forcar);
}

if (require.main === module) {
  main().catch((erro) => {
    console.error(`Falhou: ${errorMessage(erro)}`);
    process.exit(1);
  });
}
