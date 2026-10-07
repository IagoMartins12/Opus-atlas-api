import { BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeCatalogService } from './stripe-catalog.service';
import { StripeService } from './stripe.service';

const AGORA_S = Math.floor(Date.now() / 1000);

const preco = (over: Record<string, unknown> = {}) => ({
  id: 'price_m',
  active: true,
  unit_amount: 2990,
  currency: 'brl',
  product: 'prod_plus',
  lookup_key: null,
  created: AGORA_S - 86_400,
  metadata: {},
  recurring: { interval: 'month', interval_count: 1 },
  ...over,
});

const anual = (over: Record<string, unknown> = {}) =>
  preco({
    id: 'price_y',
    unit_amount: 28704,
    recurring: { interval: 'year', interval_count: 1 },
    ...over,
  });

const vigente = (over: Record<string, unknown> = {}) => ({
  id: 'pp-1',
  planType: 'PLUS',
  monthlyPrice: 29.9,
  yearlyPrice: 287.04,
  quarterlyDiscount: 10,
  biannualDiscount: 15,
  yearlyDiscount: 20,
  trialDays: 7,
  description: 'Plus',
  features: null,
  displayOrder: 1,
  stripeProductId: 'prod_plus',
  stripeMonthlyPriceId: 'price_m',
  stripeYearlyPriceId: 'price_y',
  stripeSyncedAt: null,
  origin: 'painel',
  ...over,
});

const cupom = (over: Record<string, unknown> = {}) => ({
  id: 'cup-1',
  code: 'BEMVINDO20',
  type: 'PERCENTAGE' as const,
  discountValue: 20,
  maxDiscount: null,
  validUntil: new Date(Date.now() + 30 * 86_400_000),
  maxUses: null,
  usedCount: 0,
  stripeCouponId: null,
  ...over,
});

describe('StripeCatalogService', () => {
  let client: {
    prices: {
      retrieve: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      list: jest.Mock;
    };
    products: { create: jest.Mock; update: jest.Mock; retrieve: jest.Mock };
    coupons: { create: jest.Mock; del: jest.Mock };
  };
  let prisma: {
    planPricing: {
      findFirst: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
    };
    coupon: { findFirst: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  let audit: { record: jest.Mock };
  let env: Record<string, string | undefined>;
  let service: StripeCatalogService;

  beforeEach(() => {
    client = {
      prices: {
        retrieve: jest.fn((id: string) =>
          Promise.resolve(id === 'price_y' ? anual() : preco({ id })),
        ),
        create: jest.fn((p: { recurring: { interval: string } }) =>
          Promise.resolve({ id: `novo_${p.recurring.interval}` }),
        ),
        update: jest.fn().mockResolvedValue({}),
        list: jest.fn().mockResolvedValue({ data: [preco(), anual()] }),
      },
      products: {
        create: jest.fn().mockResolvedValue({ id: 'prod_novo' }),
        update: jest.fn().mockResolvedValue({}),
        retrieve: jest
          .fn()
          .mockResolvedValue({ id: 'prod_plus', default_price: 'price_m' }),
      },
      coupons: {
        create: jest.fn().mockResolvedValue({ id: 'stripe_cupom' }),
        del: jest.fn().mockResolvedValue({}),
      },
    };
    prisma = {
      planPricing: {
        findFirst: jest.fn().mockResolvedValue(vigente()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'pp-2', ...args.data }),
        ),
      },
      coupon: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    env = { 'billing.stripeSecretKey': 'sk_test_x' };

    const stripe = {
      getClient: () => client,
      getPriceId: jest.fn(() => {
        throw new Error('Price ID do Stripe não configurado');
      }),
    };

    service = new StripeCatalogService(
      prisma as unknown as PrismaService,
      stripe as unknown as StripeService,
      { get: (chave: string) => env[chave] } as unknown as ConfigService,
      audit as unknown as AuditService,
    );
  });

  describe('o Price do checkout', () => {
    it('é o da versão vigente no banco', async () => {
      await expect(service.priceIdFor('PLUS', 'YEARLY')).resolves.toBe(
        'price_y',
      );
    });

    it('sem espelho no banco, cai no do ambiente', async () => {
      prisma.planPricing.findFirst.mockResolvedValue(
        vigente({ stripeMonthlyPriceId: null }),
      );

      await expect(service.priceIdFor('PLUS', 'MONTHLY')).rejects.toThrow(
        'não configurado',
      );
    });
  });

  describe('painel → Stripe', () => {
    // Mudar só a descrição ou os dias de teste não pode criar Price.
    it('valor igual reaproveita o Price que já existe', async () => {
      const espelho = await service.pushPricing('PLUS', {
        monthly: 29.9,
        yearly: 287.04,
      });

      expect(client.prices.create).not.toHaveBeenCalled();
      expect(espelho).toEqual({
        stripeProductId: 'prod_plus',
        stripeMonthlyPriceId: 'price_m',
        stripeYearlyPriceId: 'price_y',
      });
    });

    it('valor novo: cria o Price, troca o padrão e só então arquiva o antigo', async () => {
      const ordem: string[] = [];
      client.prices.create.mockImplementation(() => {
        ordem.push('cria');
        return Promise.resolve({ id: 'novo_month' });
      });
      client.products.update.mockImplementation(() => {
        ordem.push('padrao');
        return Promise.resolve({});
      });
      client.prices.update.mockImplementation(() => {
        ordem.push('arquiva');
        return Promise.resolve({});
      });

      const espelho = await service.pushPricing('PLUS', {
        monthly: 34.9,
        yearly: 287.04,
      });

      expect(ordem).toEqual(['cria', 'padrao', 'arquiva']);
      expect(client.prices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          product: 'prod_plus',
          currency: 'brl',
          unit_amount: 3490,
          recurring: { interval: 'month' },
          lookup_key: 'opus_plus_monthly',
          transfer_lookup_key: true,
          metadata: expect.objectContaining({ opus_origin: 'painel' }),
        }),
      );
      expect(client.prices.update).toHaveBeenCalledWith('price_m', {
        active: false,
      });
      // O anual não mudou: fica o mesmo.
      expect(espelho.stripeYearlyPriceId).toBe('price_y');
      expect(espelho.stripeMonthlyPriceId).toBe('novo_month');
    });

    it('plano sem nada no Stripe ganha produto e os dois preços', async () => {
      prisma.planPricing.findFirst.mockResolvedValue(null);

      const espelho = await service.pushPricing('MAESTRO', {
        monthly: 99,
        yearly: 950,
      });

      expect(client.products.create).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { opus_plan: 'MAESTRO' } }),
      );
      expect(client.prices.create).toHaveBeenCalledTimes(2);
      expect(espelho.stripeProductId).toBe('prod_novo');
    });

    it('recusa do Stripe vira 502 com o motivo', async () => {
      client.prices.create.mockRejectedValue(new Error('cartão da conta'));

      await expect(
        service.pushPricing('PLUS', { monthly: 50, yearly: 500 }),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });
  });

  describe('Stripe → painel', () => {
    it('igual ao banco: não cria versão', async () => {
      const r = await service.adoptFromStripe('PLUS');

      expect(r.adotado).toBe(false);
      expect(prisma.planPricing.create).not.toHaveBeenCalled();
    });

    it('preço trocado no Stripe vira versão nova, com o desconto anual recalculado', async () => {
      client.prices.list.mockResolvedValue({
        data: [preco({ id: 'price_m2', unit_amount: 3990 }), anual()],
      });
      client.products.retrieve.mockResolvedValue({
        id: 'prod_plus',
        default_price: 'price_m2',
      });

      const r = await service.adoptFromStripe('PLUS');

      expect(r.adotado).toBe(true);
      expect(prisma.planPricing.updateMany).toHaveBeenCalledWith({
        where: { planType: 'PLUS' },
        data: { isActive: false },
      });
      expect(prisma.planPricing.create.mock.calls[0][0].data).toMatchObject({
        monthlyPrice: 39.9,
        yearlyPrice: 287.04,
        // 1 − 287,04 / (39,90 × 12)
        yearlyDiscount: 40.05,
        trialDays: 7,
        stripeMonthlyPriceId: 'price_m2',
        origin: 'stripe',
        isActive: true,
      });
      // Pelo webhook não há admin na requisição: o serviço é que audita.
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'plan-pricing.pull',
          metadata: expect.objectContaining({ origem: 'webhook do Stripe' }),
        }),
      );
    });

    it('o padrão do produto ganha da chave e do que o banco aponta', async () => {
      client.prices.list.mockResolvedValue({
        data: [
          preco({ lookup_key: 'opus_plus_monthly' }),
          preco({ id: 'price_padrao', unit_amount: 4500 }),
          anual(),
        ],
      });
      client.products.retrieve.mockResolvedValue({
        id: 'prod_plus',
        default_price: 'price_padrao',
      });

      await service.adoptFromStripe('PLUS');

      expect(
        prisma.planPricing.create.mock.calls[0][0].data.stripeMonthlyPriceId,
      ).toBe('price_padrao');
    });

    // A gravação do painel está a caminho; adotar criaria duas versões.
    it('não adota o Price que o próprio painel acabou de criar', async () => {
      client.prices.list.mockResolvedValue({
        data: [
          preco({
            id: 'price_do_painel',
            unit_amount: 3490,
            created: AGORA_S - 5,
            metadata: { opus_origin: 'painel' },
          }),
          anual(),
        ],
      });
      client.products.retrieve.mockResolvedValue({
        id: 'prod_plus',
        default_price: 'price_do_painel',
      });

      const eco = await service.adoptFromStripe('PLUS');
      expect(eco.adotado).toBe(false);

      // O botão "Trazer do Stripe" não espera.
      const manual = await service.adoptFromStripe('PLUS', {
        ignorarEco: true,
        actorId: 'admin-1',
      });
      expect(manual.adotado).toBe(true);
    });

    it('sem mensal ou anual ativo, não mexe no painel', async () => {
      client.prices.list.mockResolvedValue({ data: [preco()] });

      const r = await service.adoptFromStripe('PLUS');

      expect(r.adotado).toBe(false);
      expect(prisma.planPricing.create).not.toHaveBeenCalled();
    });

    it('evento de preço de um produto nosso dispara a adoção', async () => {
      client.prices.list.mockResolvedValue({
        data: [preco({ id: 'price_m2', unit_amount: 3990 }), anual()],
      });

      const tratado = await service.handleEvent({
        type: 'price.updated',
        data: { object: preco({ active: false }) },
      } as unknown as Stripe.Event);

      expect(tratado).toBe(true);
      expect(prisma.planPricing.create).toHaveBeenCalled();
    });

    it('produto de fora do Opus Atlas é ignorado; outro tipo de evento não é daqui', async () => {
      prisma.planPricing.findFirst.mockResolvedValue(null);

      await service.handleEvent({
        type: 'product.updated',
        data: { object: { id: 'prod_alheio' } },
      } as unknown as Stripe.Event);
      expect(prisma.planPricing.create).not.toHaveBeenCalled();

      await expect(
        service.handleEvent({
          type: 'invoice.paid',
          data: { object: {} },
        } as unknown as Stripe.Event),
      ).resolves.toBe(false);
    });
  });

  describe('conferência', () => {
    it('em dia quando valor e id batem', async () => {
      const r = await service.status();
      const plus = r.planos.find((p) => p.planType === 'PLUS');

      expect(plus).toMatchObject({ emDia: true, problema: null });
    });

    it('acusa valor diferente', async () => {
      client.prices.list.mockResolvedValue({
        data: [preco({ unit_amount: 1990 }), anual()],
      });

      const r = await service.status();

      expect(r.planos[0]).toMatchObject({
        emDia: false,
        problema: 'O valor do painel é diferente do que o Stripe cobra.',
      });
    });

    it('sem chave, diz que não está configurado e não chama o Stripe', async () => {
      env['billing.stripeSecretKey'] = undefined;

      await expect(service.status()).resolves.toEqual({
        configurado: false,
        planos: [],
      });
      expect(client.products.retrieve).not.toHaveBeenCalled();
    });
  });

  describe('cupons', () => {
    it('percentual vira cupom de uma cobrança, com validade e o código no nome', async () => {
      const id = await service.syncCoupon(cupom({ maxUses: 10, usedCount: 4 }));

      expect(id).toBe('stripe_cupom');
      expect(client.coupons.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'BEMVINDO20',
          duration: 'once',
          percent_off: 20,
          max_redemptions: 6,
          redeem_by: expect.any(Number),
        }),
      );
      expect(prisma.coupon.update.mock.calls[0][0].data).toMatchObject({
        stripeCouponId: 'stripe_cupom',
        stripeSyncError: null,
      });
    });

    it('valor fixo vai em centavos de real', async () => {
      await service.syncCoupon(cupom({ type: 'FIXED', discountValue: 15.5 }));

      expect(client.coupons.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount_off: 1550, currency: 'brl' }),
      );
    });

    it('já espelhado não é recriado', async () => {
      const id = await service.syncCoupon(cupom({ stripeCouponId: 'ja_tem' }));

      expect(id).toBe('ja_tem');
      expect(client.coupons.create).not.toHaveBeenCalled();
    });

    // O `coupon.deleted` que volta pelo webhook procura o dono pelo id.
    it('recriar aponta o banco para o novo antes de apagar o antigo', async () => {
      const ordem: string[] = [];
      prisma.coupon.update.mockImplementation(() => {
        ordem.push('banco');
        return Promise.resolve({});
      });
      client.coupons.del.mockImplementation(() => {
        ordem.push('apaga');
        return Promise.resolve({});
      });

      await service.syncCoupon(cupom({ stripeCouponId: 'antigo' }), {
        recriar: true,
      });

      expect(ordem).toEqual(['banco', 'apaga']);
      expect(client.coupons.del).toHaveBeenCalledWith('antigo');
    });

    it('teste grátis estendido não tem espelho', async () => {
      const id = await service.syncCoupon(cupom({ type: 'FREE_TRIAL' }));

      expect(id).toBeNull();
      expect(client.coupons.create).not.toHaveBeenCalled();
    });

    it('recusa do Stripe fica gravada no cupom, sem lançar', async () => {
      client.coupons.create.mockRejectedValue(
        new Error('percent_off inválido'),
      );

      await expect(service.syncCoupon(cupom())).resolves.toBeNull();
      expect(prisma.coupon.update.mock.calls[0][0].data.stripeSyncError).toBe(
        'percent_off inválido',
      );
    });

    it('apagar o que já não existe no Stripe não é erro', async () => {
      client.coupons.del.mockRejectedValue({ code: 'resource_missing' });

      await expect(service.deleteCoupon('sumiu')).resolves.toBeUndefined();
    });

    describe('no checkout', () => {
      it('leva o espelho do cupom', async () => {
        await expect(
          service.checkoutCouponId(cupom(), 29.9, 5.98),
        ).resolves.toBe('stripe_cupom');
      });

      // O Stripe não tem percentual com teto.
      it('teto cortou o desconto: cupom avulso com o valor exato, de um uso', async () => {
        await service.checkoutCouponId(
          cupom({ discountValue: 50, maxDiscount: 10 }),
          100,
          10,
        );

        expect(client.coupons.create).toHaveBeenCalledWith(
          expect.objectContaining({
            amount_off: 1000,
            currency: 'brl',
            max_redemptions: 1,
          }),
        );
      });

      // Abrir o checkout sem o cupom cobraria o preço cheio.
      it('cupom com desconto que não chega ao Stripe impede o checkout', async () => {
        client.coupons.create.mockRejectedValue(new Error('fora do ar'));

        await expect(
          service.checkoutCouponId(cupom(), 29.9, 5.98),
        ).rejects.toBeInstanceOf(BadGatewayException);
      });

      it('teste grátis não leva desconto à sessão', async () => {
        await expect(
          service.checkoutCouponId(cupom({ type: 'FREE_TRIAL' }), 29.9, 0),
        ).resolves.toBeNull();
      });
    });

    it('apagado no painel do Stripe: o nosso sai do ar, com o motivo', async () => {
      prisma.coupon.findFirst.mockResolvedValue({ id: 'cup-1', code: 'X' });

      await service.handleEvent({
        type: 'coupon.deleted',
        data: { object: { id: 'stripe_cupom' } },
      } as unknown as Stripe.Event);

      expect(prisma.coupon.update.mock.calls[0][0].data).toMatchObject({
        isActive: false,
        stripeCouponId: null,
      });
      expect(audit.record).toHaveBeenCalled();
    });

    it('apagado no Stripe sem dono aqui (espelho antigo ou avulso): nada muda', async () => {
      await service.handleEvent({
        type: 'coupon.deleted',
        data: { object: { id: 'avulso' } },
      } as unknown as Stripe.Event);

      expect(prisma.coupon.update).not.toHaveBeenCalled();
    });
  });
});
