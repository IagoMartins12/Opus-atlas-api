import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingPeriod, CouponType, PlanType, Prisma } from '@prisma/client';
import type Stripe from 'stripe';
import { AuditService } from '../../common/audit/audit.service';
import { errorMessage } from '../../common/utils/error.util';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from './stripe.service';

/** Os planos que o Stripe cobra; o gratuito não tem Price. */
export const PLANOS_PAGOS = ['PLUS', 'MENTOR', 'MAESTRO'] as const;
export type PlanoPago = (typeof PLANOS_PAGOS)[number];

const PERIODOS: BillingPeriod[] = ['MONTHLY', 'YEARLY'];
const INTERVALO: Record<BillingPeriod, 'month' | 'year'> = {
  MONTHLY: 'month',
  YEARLY: 'year',
};

/** Uma mudança nossa volta pelo webhook em segundos; isto é o "acabou de". */
const ECO_DO_PAINEL_S = 120;

const centavos = (valor: number) => Math.round(valor * 100);
const reais = (cents: number | null | undefined) => (cents ?? 0) / 100;
const chaveDoPreco = (plano: PlanType, periodo: BillingPeriod) =>
  `opus_${plano}_${periodo}`.toLowerCase();

const ehPlanoPago = (plano: string): plano is PlanoPago =>
  (PLANOS_PAGOS as readonly string[]).includes(plano);

export interface EspelhoDePreco {
  stripeProductId: string;
  stripeMonthlyPriceId: string;
  stripeYearlyPriceId: string;
}

interface CupomParaEspelhar {
  id: string;
  code: string;
  type: CouponType;
  discountValue: number;
  maxDiscount?: number | null;
  validUntil: Date;
  maxUses: number | null;
  usedCount: number;
  stripeCouponId: string | null;
}

/**
 * O catálogo do Stripe — Prices dos planos e cupons — em sincronia com o
 * painel, nos dois sentidos.
 *
 * **O que estava errado.** O preço do painel (`PlanPricing`) era o que a
 * página de preços mostrava; o que o Stripe cobrava era o Price ID fixo no
 * `.env`. Mudar o preço no painel mudava a vitrine e não a cobrança. E o
 * cupom existia só no nosso banco: o checkout abria sem desconto, a pessoa
 * via "cupom aplicado" e pagava o preço cheio.
 *
 * **Painel → Stripe.** Price no Stripe é imutável no valor: mudar preço é
 * criar um Price novo, fazê-lo o padrão do produto e arquivar o anterior.
 * Quem já assina continua no Price antigo (arquivado ainda cobra). Cupom
 * também é imutável: editar o desconto cria outro e apaga o antigo.
 *
 * **Stripe → painel.** Os eventos `price.*` e `product.updated` do webhook
 * (e o botão "Trazer do Stripe") releem o que está valendo lá e, se difere,
 * criam uma versão nova em `PlanPricing` com origem `stripe`.
 *
 * O Price que vale para um plano/período, nesta ordem: o padrão do produto
 * (só diz respeito ao período dele), o que carrega a chave
 * `opus_<plano>_<periodo>`, o único ativo daquele período, o que o banco já
 * aponta, o mais novo.
 */
@Injectable()
export class StripeCatalogService {
  private readonly logger = new Logger(StripeCatalogService.name);
  /** produto do Stripe → plano, para não reler o Stripe a cada evento. */
  private readonly planoDoProduto = new Map<string, PlanoPago>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  /** Sem chave (ambiente local sem Stripe) nada aqui fala com o Stripe. */
  isConfigured(): boolean {
    return !!this.config.get<string>('billing.stripeSecretKey');
  }

  // -------------------------------------------------------------------
  // Preços
  // -------------------------------------------------------------------

  private envPriceId(plano: PlanType, periodo: BillingPeriod): string | null {
    return (
      this.config.get<string>(`billing.priceIds.${plano}.${periodo}`) ?? null
    );
  }

  private async vigente(plano: PlanType) {
    return this.prisma.planPricing.findFirst({
      where: { planType: plano, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * O Price que o checkout usa: o da versão vigente no banco e, enquanto ela
   * não tiver espelho, o do ambiente — que era a única fonte antes.
   */
  async priceIdFor(plano: PlanType, periodo: BillingPeriod): Promise<string> {
    const atual = await this.vigente(plano);
    const doBanco =
      periodo === 'MONTHLY'
        ? atual?.stripeMonthlyPriceId
        : atual?.stripeYearlyPriceId;

    return doBanco ?? this.stripe.getPriceId(plano, periodo);
  }

  private async priceIdOrNull(
    plano: PlanType,
    periodo: BillingPeriod,
  ): Promise<string | null> {
    const atual = await this.vigente(plano);
    const doBanco =
      periodo === 'MONTHLY'
        ? atual?.stripeMonthlyPriceId
        : atual?.stripeYearlyPriceId;

    return doBanco ?? this.envPriceId(plano, periodo);
  }

  private async retrievePrice(id: string): Promise<Stripe.Price | null> {
    try {
      return await this.stripe.getClient().prices.retrieve(id);
    } catch (error: unknown) {
      this.logger.warn(`Price ${id} não pôde ser lido: ${errorMessage(error)}`);
      return null;
    }
  }

  private productIdOf(price: Stripe.Price | null): string | null {
    if (!price) return null;
    return typeof price.product === 'string' ? price.product : price.product.id;
  }

  /**
   * Leva o preço do painel ao Stripe e devolve os ids que passam a cobrar.
   *
   * Reaproveita o Price que já tem o mesmo valor — mudar só a descrição ou os
   * dias de teste não pode criar Price novo. Lança `BadGateway` se o Stripe
   * recusar: o chamador não grava a versão, porque painel e cobrança
   * divergirem é exatamente o defeito que isto conserta.
   */
  async pushPricing(
    plano: PlanoPago,
    valores: { monthly: number; yearly: number },
  ): Promise<EspelhoDePreco> {
    const client = this.stripe.getClient();

    try {
      const atuais = {
        MONTHLY: await this.priceIdOrNull(plano, 'MONTHLY'),
        YEARLY: await this.priceIdOrNull(plano, 'YEARLY'),
      };
      const lidos = {
        MONTHLY: atuais.MONTHLY
          ? await this.retrievePrice(atuais.MONTHLY)
          : null,
        YEARLY: atuais.YEARLY ? await this.retrievePrice(atuais.YEARLY) : null,
      };

      let productId =
        (await this.vigente(plano))?.stripeProductId ??
        this.productIdOf(lidos.MONTHLY) ??
        this.productIdOf(lidos.YEARLY);

      if (!productId) {
        const product = await client.products.create({
          name: `Opus Atlas — ${plano}`,
          metadata: { opus_plan: plano },
        });
        productId = product.id;
      }

      const alvo = { MONTHLY: valores.monthly, YEARLY: valores.yearly };
      const ids = {} as Record<BillingPeriod, string>;

      for (const periodo of PERIODOS) {
        const existente = lidos[periodo];
        const valor = centavos(alvo[periodo]);

        if (
          existente?.active &&
          existente.unit_amount === valor &&
          existente.currency === 'brl' &&
          this.productIdOf(existente) === productId
        ) {
          ids[periodo] = existente.id;
          continue;
        }

        const novo = await client.prices.create({
          product: productId,
          currency: 'brl',
          unit_amount: valor,
          recurring: { interval: INTERVALO[periodo] },
          lookup_key: chaveDoPreco(plano, periodo),
          transfer_lookup_key: true,
          metadata: {
            opus_plan: plano,
            opus_period: periodo,
            opus_origin: 'painel',
          },
        });
        ids[periodo] = novo.id;

        // O padrão do produto troca antes de arquivar: o Stripe não deixa
        // arquivar o Price padrão.
        if (periodo === 'MONTHLY') {
          await client.products.update(productId, { default_price: novo.id });
        }

        if (existente?.active) {
          await client.prices
            .update(existente.id, { active: false })
            .catch((error: unknown) =>
              this.logger.warn(
                `Price antigo ${existente.id} não foi arquivado: ${errorMessage(error)}`,
              ),
            );
        }
      }

      this.planoDoProduto.set(productId, plano);

      return {
        stripeProductId: productId,
        stripeMonthlyPriceId: ids.MONTHLY,
        stripeYearlyPriceId: ids.YEARLY,
      };
    } catch (error: unknown) {
      this.logger.error(
        `Preço de ${plano} não chegou ao Stripe: ${errorMessage(error)}`,
      );
      throw new BadGatewayException(
        `O Stripe não aceitou o preço novo (${errorMessage(error)}). Nada foi alterado.`,
      );
    }
  }

  /** O produto do plano: o do banco ou o do Price do ambiente. */
  private async productIdFor(plano: PlanoPago): Promise<string | null> {
    const doBanco = (await this.vigente(plano))?.stripeProductId;
    if (doBanco) return doBanco;

    for (const periodo of PERIODOS) {
      const id = this.envPriceId(plano, periodo);
      const productId = id
        ? this.productIdOf(await this.retrievePrice(id))
        : null;
      if (productId) return productId;
    }

    return null;
  }

  /** O que o Stripe tem valendo para o plano, por período. */
  private async readStripe(plano: PlanoPago): Promise<{
    productId: string | null;
    precos: Record<BillingPeriod, Stripe.Price | null>;
  }> {
    const vazio = { MONTHLY: null, YEARLY: null };
    const productId = await this.productIdFor(plano);
    if (!productId) return { productId: null, precos: vazio };

    const client = this.stripe.getClient();
    const [product, lista, atual] = await Promise.all([
      client.products.retrieve(productId),
      client.prices.list({ product: productId, active: true, limit: 100 }),
      this.vigente(plano),
    ]);
    const padrao =
      typeof product.default_price === 'string'
        ? product.default_price
        : (product.default_price?.id ?? null);
    const doBanco: Record<BillingPeriod, string | null | undefined> = {
      MONTHLY: atual?.stripeMonthlyPriceId,
      YEARLY: atual?.stripeYearlyPriceId,
    };

    const precos = {} as Record<BillingPeriod, Stripe.Price | null>;
    for (const periodo of PERIODOS) {
      const candidatos = lista.data.filter(
        (p) =>
          p.recurring?.interval === INTERVALO[periodo] &&
          (p.recurring.interval_count ?? 1) === 1 &&
          p.currency === 'brl',
      );
      precos[periodo] =
        candidatos.find((p) => p.id === padrao) ??
        candidatos.find((p) => p.lookup_key === chaveDoPreco(plano, periodo)) ??
        (candidatos.length === 1 ? candidatos[0] : undefined) ??
        candidatos.find((p) => p.id === doBanco[periodo]) ??
        [...candidatos].sort((a, b) => b.created - a.created)[0] ??
        null;
    }

    this.planoDoProduto.set(productId, plano);
    return { productId, precos };
  }

  /**
   * Painel e Stripe lado a lado, plano a plano — o que a tela de preços
   * mostra para dizer se o que está escrito é o que é cobrado.
   */
  async status() {
    if (!this.isConfigured()) {
      return { configurado: false as const, planos: [] };
    }

    const planos = await Promise.all(
      PLANOS_PAGOS.map(async (plano) => {
        const atual = await this.vigente(plano);
        const painel = atual
          ? {
              monthly: atual.monthlyPrice,
              yearly: atual.yearlyPrice ?? atual.monthlyPrice * 12,
            }
          : null;

        try {
          const { productId, precos } = await this.readStripe(plano);
          const lado = (periodo: BillingPeriod) => {
            const p = precos[periodo];
            return p ? { id: p.id, valor: reais(p.unit_amount) } : null;
          };
          const stripe = { monthly: lado('MONTHLY'), yearly: lado('YEARLY') };
          const bate = (a?: number, b?: number) =>
            a !== undefined && b !== undefined && centavos(a) === centavos(b);
          const valoresIguais =
            bate(painel?.monthly, stripe.monthly?.valor) &&
            bate(painel?.yearly, stripe.yearly?.valor);
          // Valor igual mas apontando para outro Price ainda é desvio: o
          // checkout usaria o id antigo.
          const idsIguais =
            (atual?.stripeMonthlyPriceId ??
              this.envPriceId(plano, 'MONTHLY')) === stripe.monthly?.id &&
            (atual?.stripeYearlyPriceId ?? this.envPriceId(plano, 'YEARLY')) ===
              stripe.yearly?.id;

          return {
            planType: plano,
            painel,
            stripe,
            productId,
            fonte: atual?.stripeMonthlyPriceId ? 'banco' : 'ambiente',
            emDia: valoresIguais && idsIguais,
            problema: !productId
              ? 'Nenhum produto no Stripe para este plano.'
              : !stripe.monthly || !stripe.yearly
                ? 'Falta um preço ativo no Stripe (mensal ou anual).'
                : !valoresIguais
                  ? 'O valor do painel é diferente do que o Stripe cobra.'
                  : !idsIguais
                    ? 'O checkout aponta para um preço que não é mais o vigente no Stripe.'
                    : null,
            sincronizadoEm: atual?.stripeSyncedAt ?? null,
            origem: atual?.origin ?? null,
          };
        } catch (error: unknown) {
          return {
            planType: plano,
            painel,
            stripe: { monthly: null, yearly: null },
            productId: null,
            fonte: null,
            emDia: false,
            problema: `Não foi possível ler o Stripe: ${errorMessage(error)}`,
            sincronizadoEm: atual?.stripeSyncedAt ?? null,
            origem: atual?.origin ?? null,
          };
        }
      }),
    );

    return { configurado: true as const, planos };
  }

  /**
   * Stripe → painel: se o que vale no Stripe difere do banco, cria uma versão
   * nova com os valores de lá.
   *
   * `ignorarEco` é do botão manual. Pelo webhook, um Price que o próprio
   * painel acabou de criar não é adotado — a gravação do painel está a
   * caminho, e adotar aqui criaria duas versões iguais.
   */
  async adoptFromStripe(
    plano: PlanoPago,
    opcoes: { ignorarEco?: boolean; actorId?: string } = {},
  ): Promise<{ adotado: boolean; motivo: string }> {
    const { productId, precos } = await this.readStripe(plano);
    const mensal = precos.MONTHLY;
    const anual = precos.YEARLY;

    if (!productId || !mensal || !anual) {
      return {
        adotado: false,
        motivo: 'O Stripe não tem preço mensal e anual ativos para este plano.',
      };
    }

    const atual = await this.vigente(plano);
    const igual =
      atual?.stripeMonthlyPriceId === mensal.id &&
      atual?.stripeYearlyPriceId === anual.id &&
      centavos(atual.monthlyPrice) === mensal.unit_amount &&
      centavos(atual.yearlyPrice ?? 0) === anual.unit_amount;

    if (igual) {
      return { adotado: false, motivo: 'O painel já está igual ao Stripe.' };
    }

    if (!opcoes.ignorarEco) {
      const agora = Date.now() / 1000;
      const eco = [mensal, anual].some(
        (p) =>
          p.metadata?.opus_origin === 'painel' &&
          agora - p.created < ECO_DO_PAINEL_S,
      );
      if (eco) {
        return { adotado: false, motivo: 'Mudança feita pelo próprio painel.' };
      }
    }

    const monthly = reais(mensal.unit_amount);
    const yearly = reais(anual.unit_amount);
    // O desconto anual deixa de ser uma escolha e passa a ser o que o Stripe
    // cobra: sai da razão entre os dois preços.
    const yearlyDiscount =
      monthly > 0
        ? Math.max(0, Math.round((1 - yearly / (monthly * 12)) * 10000) / 100)
        : 0;

    const nova = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        await tx.planPricing.updateMany({
          where: { planType: plano },
          data: { isActive: false },
        });

        return tx.planPricing.create({
          data: {
            planType: plano,
            monthlyPrice: monthly,
            quarterlyPrice: null,
            biannualPrice: null,
            quarterlyDiscount: 0,
            biannualDiscount: 0,
            yearlyPrice: yearly,
            yearlyDiscount,
            trialDays: atual?.trialDays ?? 0,
            description: atual?.description,
            features: atual?.features ?? undefined,
            displayOrder: atual?.displayOrder ?? 0,
            isActive: true,
            stripeProductId: productId,
            stripeMonthlyPriceId: mensal.id,
            stripeYearlyPriceId: anual.id,
            stripeSyncedAt: new Date(),
            origin: 'stripe',
          },
        });
      },
    );

    // Pelo webhook não há requisição de admin para o interceptor auditar.
    await this.audit.record({
      actorId: opcoes.actorId,
      action: 'plan-pricing.pull',
      entityType: 'planPricing',
      entityId: nova.id,
      success: true,
      metadata: {
        alvo: plano,
        origem: opcoes.actorId ? 'painel' : 'webhook do Stripe',
        mudancas: [
          {
            campo: 'monthlyPrice',
            de: atual?.monthlyPrice ?? null,
            para: monthly,
          },
          {
            campo: 'yearlyPrice',
            de: atual?.yearlyPrice ?? null,
            para: yearly,
          },
        ],
      },
    });

    this.logger.log(
      `Preço de ${plano} adotado do Stripe: R$ ${monthly}/mês, R$ ${yearly}/ano`,
    );

    return {
      adotado: true,
      motivo: 'Versão nova criada com os valores do Stripe.',
    };
  }

  private async planOf(productId: string): Promise<PlanoPago | null> {
    const conhecido = this.planoDoProduto.get(productId);
    if (conhecido) return conhecido;

    const doBanco = await this.prisma.planPricing.findFirst({
      where: { stripeProductId: productId },
      select: { planType: true },
    });
    if (doBanco && ehPlanoPago(doBanco.planType)) {
      this.planoDoProduto.set(productId, doBanco.planType);
      return doBanco.planType;
    }

    for (const plano of PLANOS_PAGOS) {
      if ((await this.productIdFor(plano)) === productId) {
        this.planoDoProduto.set(productId, plano);
        return plano;
      }
    }

    return null;
  }

  /**
   * Eventos de catálogo do webhook. Devolve `false` quando o evento não é
   * daqui, para o `WebhookService` seguir com os outros.
   */
  async handleEvent(event: Stripe.Event): Promise<boolean> {
    switch (event.type) {
      case 'price.created':
      case 'price.updated':
      case 'price.deleted': {
        const price = event.data.object;
        const productId =
          typeof price.product === 'string' ? price.product : price.product.id;
        await this.adoptForProduct(productId);
        return true;
      }

      case 'product.updated': {
        await this.adoptForProduct(event.data.object.id);
        return true;
      }

      case 'coupon.deleted': {
        await this.couponDeletedInStripe(event.data.object.id);
        return true;
      }

      default:
        return false;
    }
  }

  private async adoptForProduct(productId: string): Promise<void> {
    const plano = await this.planOf(productId);

    if (!plano) {
      this.logger.debug(
        `Produto ${productId} não é de um plano do Opus Atlas — ignorado`,
      );
      return;
    }

    const resultado = await this.adoptFromStripe(plano);
    this.logger.log(`Stripe → painel (${plano}): ${resultado.motivo}`);
  }

  // -------------------------------------------------------------------
  // Cupons
  // -------------------------------------------------------------------

  private couponParams(
    cupom: CupomParaEspelhar,
  ): Stripe.CouponCreateParams | null {
    // Teste grátis estendido não é desconto em dinheiro: não tem espelho.
    if (cupom.type === 'FREE_TRIAL' || cupom.discountValue <= 0) return null;

    const restantes =
      cupom.maxUses === null ? null : cupom.maxUses - cupom.usedCount;
    if (restantes !== null && restantes <= 0) return null;

    const validade = Math.floor(cupom.validUntil.getTime() / 1000);
    const agora = Math.floor(Date.now() / 1000);
    const cincoAnos = 5 * 365 * 24 * 60 * 60;

    return {
      name: cupom.code.slice(0, 40),
      // Uma vez: o desconto é da primeira cobrança, como o painel calcula.
      duration: 'once',
      ...(cupom.type === 'PERCENTAGE'
        ? { percent_off: Math.min(100, cupom.discountValue) }
        : { amount_off: centavos(cupom.discountValue), currency: 'brl' }),
      // O Stripe recusa validade no passado e muito distante; a validade que
      // manda é a do nosso banco, conferida antes de abrir o checkout.
      ...(validade > agora && validade - agora < cincoAnos
        ? { redeem_by: validade }
        : {}),
      ...(restantes !== null ? { max_redemptions: restantes } : {}),
      metadata: { opus_coupon_id: cupom.id, opus_code: cupom.code },
    };
  }

  /**
   * Garante o espelho do cupom no Stripe e devolve o id (ou `null` quando o
   * cupom não tem desconto em dinheiro). `recriar` troca o espelho: cupom do
   * Stripe não se edita.
   *
   * Não lança: grava o motivo em `stripeSyncError` e devolve `null`. Quem
   * abre o checkout decide se isso impede a venda.
   */
  async syncCoupon(
    cupom: CupomParaEspelhar,
    opcoes: { recriar?: boolean } = {},
  ): Promise<string | null> {
    if (cupom.stripeCouponId && !opcoes.recriar) return cupom.stripeCouponId;

    if (!this.isConfigured()) {
      await this.markCoupon(cupom.id, {
        stripeSyncError: 'Stripe não configurado neste ambiente.',
      });
      return null;
    }

    const params = this.couponParams(cupom);

    try {
      const anterior = cupom.stripeCouponId;
      const criado = params
        ? await this.stripe.getClient().coupons.create(params)
        : null;

      // O banco aponta para o novo **antes** de o antigo ser apagado: o
      // `coupon.deleted` que volta pelo webhook procura o dono pelo id, e
      // achar o nosso cupom o desativaria.
      await this.markCoupon(cupom.id, {
        stripeCouponId: criado?.id ?? null,
        stripeSyncedAt: new Date(),
        stripeSyncError: null,
      });
      if (anterior) await this.deleteCoupon(anterior);

      return criado?.id ?? null;
    } catch (error: unknown) {
      this.logger.error(
        `Cupom ${cupom.code} não chegou ao Stripe: ${errorMessage(error)}`,
      );
      await this.markCoupon(cupom.id, {
        stripeSyncError: errorMessage(error).slice(0, 300),
      });
      return null;
    }
  }

  private async markCoupon(
    id: string,
    data: Prisma.CouponUpdateInput,
  ): Promise<void> {
    await this.prisma.coupon
      .update({ where: { id }, data })
      .catch((error: unknown) =>
        this.logger.warn(
          `Estado do espelho do cupom ${id} não foi gravado: ${errorMessage(error)}`,
        ),
      );
  }

  /** Apaga o cupom no Stripe; já não existir lá não é erro. */
  async deleteCoupon(stripeCouponId: string): Promise<void> {
    if (!this.isConfigured()) return;

    try {
      await this.stripe.getClient().coupons.del(stripeCouponId);
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'resource_missing') return;
      throw error;
    }
  }

  /**
   * O cupom do Stripe que a sessão de checkout leva.
   *
   * Percentual com teto (`maxDiscount`) não existe no Stripe. Quando o teto
   * corta o desconto, a sessão leva um cupom de valor fixo, de um uso só,
   * com exatamente o desconto que o painel calculou.
   *
   * Lança `BadGateway` se o cupom tem desconto e não pôde ser levado: abrir o
   * checkout sem ele cobraria o preço cheio de quem viu "cupom aplicado".
   */
  async checkoutCouponId(
    cupom: CupomParaEspelhar,
    precoCheio: number,
    desconto: number,
  ): Promise<string | null> {
    if (cupom.type === 'FREE_TRIAL' || desconto <= 0) return null;

    const nominal =
      cupom.type === 'PERCENTAGE'
        ? precoCheio * (cupom.discountValue / 100)
        : cupom.discountValue;
    const tetoCortou =
      cupom.type === 'PERCENTAGE' && centavos(desconto) < centavos(nominal);

    if (tetoCortou) {
      try {
        const avulso = await this.stripe.getClient().coupons.create({
          name: `${cupom.code} (teto)`.slice(0, 40),
          duration: 'once',
          amount_off: centavos(desconto),
          currency: 'brl',
          max_redemptions: 1,
          metadata: { opus_coupon_id: cupom.id, opus_code: cupom.code },
        });
        return avulso.id;
      } catch (error: unknown) {
        throw new BadGatewayException(
          `Não foi possível aplicar o cupom agora (${errorMessage(error)}). Tente de novo em instantes.`,
        );
      }
    }

    const id = await this.syncCoupon(cupom);

    if (!id) {
      throw new BadGatewayException(
        'Não foi possível aplicar o cupom agora. Tente de novo em instantes.',
      );
    }

    return id;
  }

  /**
   * Alguém apagou o cupom no painel do Stripe: o nosso sai do ar, com o
   * motivo. Recriar sozinho desfaria uma decisão tomada lá.
   */
  private async couponDeletedInStripe(stripeCouponId: string): Promise<void> {
    const cupom = await this.prisma.coupon.findFirst({
      where: { stripeCouponId },
      select: { id: true, code: true },
    });

    // Sem dono: é um avulso de teto, ou o espelho antigo que nós mesmos
    // trocamos (o id no banco já é o novo).
    if (!cupom) return;

    await this.prisma.coupon.update({
      where: { id: cupom.id },
      data: {
        isActive: false,
        stripeCouponId: null,
        stripeSyncError: 'Apagado no Stripe; desativado aqui.',
      },
    });
    await this.audit.record({
      action: 'coupon.toggle',
      entityType: 'coupon',
      entityId: cupom.id,
      success: true,
      metadata: {
        alvo: cupom.code,
        origem: 'webhook do Stripe',
        mudancas: [{ campo: 'isActive', de: true, para: false }],
      },
    });
  }
}
