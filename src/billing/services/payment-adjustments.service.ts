import { Injectable, Logger } from '@nestjs/common';
import { PaymentAdjustmentKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from './stripe.service';

export interface MoneyEvent {
  /** O id do Stripe do reembolso (`re_…`) ou da contestação (`dp_…`). */
  id: string;
  paymentIntentId: string | null;
  amountCents: number;
  currency: string;
  /** Quando o dinheiro se mexeu (o evento), não quando soubemos. */
  at: Date;
}

/**
 * O dinheiro que sai (ou volta) depois de um pagamento aprovado: reembolso,
 * contestação aberta, ganha e a tarifa dela. Cada um é uma linha com o id do
 * Stripe como chave única, e por isso um webhook repetido conta uma vez só.
 *
 * Sem isto a receita do financeiro ficava no que foi cobrado, não no que
 * ficou: um reembolso ou uma contestação perdida não aparecia em lugar nenhum.
 */
@Injectable()
export class PaymentAdjustmentsService {
  private readonly logger = new Logger(PaymentAdjustmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  /** Reembolso concluído: tira da receita e, se foi total, marca o pagamento. */
  async registerRefund(event: MoneyEvent): Promise<void> {
    const paymentId = await this.paymentOf(event.paymentIntentId);
    const created = await this.record('REFUND', event.id, event, paymentId);
    if (created && paymentId) await this.markRefundedIfTotal(paymentId);
  }

  /**
   * Contestação aberta com o dinheiro já retirado: o valor sai da receita, e a
   * tarifa da contestação (`feeCents`, lida das transações dela) também.
   */
  async registerDisputeOpened(
    event: MoneyEvent & { feeCents: number },
  ): Promise<void> {
    const paymentId = await this.paymentOf(event.paymentIntentId);
    await this.record('DISPUTE', event.id, event, paymentId);
    if (event.feeCents > 0) {
      await this.record(
        'DISPUTE_FEE',
        `${event.id}:fee`,
        { ...event, amountCents: event.feeCents },
        paymentId,
      );
    }
  }

  /** Contestação ganha: o Stripe devolve o valor (a tarifa fica). */
  async registerDisputeWon(event: MoneyEvent): Promise<void> {
    const paymentId = await this.paymentOf(event.paymentIntentId);
    await this.record('DISPUTE_WON', `${event.id}:won`, event, paymentId);
  }

  /** Grava uma vez; devolve `false` se a mesma referência já estava lá. */
  private async record(
    kind: PaymentAdjustmentKind,
    stripeRef: string,
    event: MoneyEvent,
    paymentId: string | null,
  ): Promise<boolean> {
    // O índice único do banco é a trava final, mas ele só existe depois do
    // `prisma db push`: um deploy sem ele contava o mesmo reembolso duas vezes.
    // A conferência aqui não depende dele.
    const existing = await this.prisma.paymentAdjustment.findFirst({
      where: { stripeRef },
      select: { id: true },
    });
    if (existing) {
      this.logger.debug(`Ajuste ${stripeRef} já registrado, ignorando`);
      return false;
    }

    try {
      await this.prisma.paymentAdjustment.create({
        data: {
          kind,
          stripeRef,
          paymentId,
          amountCents: Math.abs(event.amountCents),
          currency: event.currency.toUpperCase(),
          at: event.at,
        },
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.logger.debug(`Ajuste ${stripeRef} já registrado, ignorando`);
        return false;
      }
      throw error;
    }
  }

  /**
   * O pagamento de um PaymentIntent: pelo que foi guardado na hora, ou — para
   * os anteriores a isso — pela fatura do PaymentIntent (e já guarda o id
   * para a próxima). Sem achar, `null`: o ajuste vale mesmo assim.
   */
  private async paymentOf(
    paymentIntentId: string | null,
  ): Promise<string | null> {
    if (!paymentIntentId) return null;

    const direct = await this.prisma.payment.findFirst({
      where: { stripePaymentIntentId: paymentIntentId },
      select: { id: true },
    });
    if (direct) return direct.id;

    const invoiceId =
      await this.stripe.invoiceIdForPaymentIntent(paymentIntentId);
    if (!invoiceId) return null;

    const byInvoice = await this.prisma.payment.findFirst({
      where: { stripeInvoiceId: invoiceId },
      select: { id: true },
    });
    if (!byInvoice) return null;

    await this.prisma.payment.update({
      where: { id: byInvoice.id },
      data: { stripePaymentIntentId: paymentIntentId },
    });
    return byInvoice.id;
  }

  private async markRefundedIfTotal(paymentId: string): Promise<void> {
    const [payment, refunds] = await Promise.all([
      this.prisma.payment.findUnique({
        where: { id: paymentId },
        select: { finalAmount: true, status: true },
      }),
      this.prisma.paymentAdjustment.findMany({
        where: { paymentId, kind: 'REFUND' },
        select: { amountCents: true },
      }),
    ]);
    if (!payment || payment.status === 'REFUNDED') return;

    const refunded = refunds.reduce((total, r) => total + r.amountCents, 0);
    if (refunded >= Math.round(payment.finalAmount * 100)) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: 'REFUNDED' },
      });
    }
  }
}
