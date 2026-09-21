import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { escapeHtml } from '../../common/utils/html.util';
import { PrismaService } from '../../prisma/prisma.service';
import { InvoiceDetailResponseDto } from '../dto/invoice-detail-response.dto';

const PLAN_NAMES: Record<string, string> = {
  FREE: 'Gratuito',
  PLUS: 'Plus',
  MENTOR: 'Mentor',
  MAESTRO: 'Maestro',
};

function formatPriceBRL(price: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(price);
}

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  private async findAuthorized(
    userId: string,
    isAdmin: boolean,
    invoiceId: string,
  ) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { subscription: { include: { user: true } }, payment: true },
    });

    if (!invoice) {
      throw new NotFoundException('Nota fiscal não encontrada');
    }

    if (invoice.subscription.userId !== userId && !isAdmin) {
      throw new ForbiddenException(
        'Sem permissão para acessar esta nota fiscal',
      );
    }

    return invoice;
  }

  async getDetail(
    userId: string,
    isAdmin: boolean,
    invoiceId: string,
  ): Promise<InvoiceDetailResponseDto> {
    const invoice = await this.findAuthorized(userId, isAdmin, invoiceId);

    return {
      success: true,
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        amount: invoice.amount,
        taxAmount: invoice.taxAmount,
        totalAmount: invoice.totalAmount,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        paidAt: invoice.paidAt,
        customerName: invoice.customerName,
        customerEmail: invoice.customerEmail,
        description: invoice.description,
        pdfUrl: invoice.pdfUrl,
      },
      subscription: {
        planType: invoice.subscription.planType,
        billingPeriod: invoice.subscription.billingPeriod,
      },
      payment: {
        paymentMethod: invoice.payment.paymentMethod,
        status: invoice.payment.status,
        paidAt: invoice.payment.paidAt,
      },
    };
  }

  async getHtml(
    userId: string,
    isAdmin: boolean,
    invoiceId: string,
  ): Promise<string> {
    const invoice = await this.findAuthorized(userId, isAdmin, invoiceId);

    if (invoice.pdfUrl) {
      return this.wrapPdfRedirectHtml(invoice.pdfUrl);
    }

    return this.renderInvoiceHtml({
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      customerName: invoice.customerName,
      customerEmail: invoice.customerEmail,
      customerDocument: invoice.customerDocument,
      customerAddress: invoice.customerAddress,
      customerCity: invoice.customerCity,
      customerState: invoice.customerState,
      customerZipCode: invoice.customerZipCode,
      serviceName: `Assinatura ${PLAN_NAMES[invoice.subscription.planType]}`,
      serviceDescription: invoice.description,
      amount: invoice.amount,
      taxAmount: invoice.taxAmount,
      totalAmount: invoice.totalAmount,
      companyName: invoice.companyName,
      companyDocument: invoice.companyDocument,
      companyAddress: invoice.companyAddress,
      paymentMethod: invoice.payment.paymentMethod ?? undefined,
      paidAt: invoice.paidAt ?? undefined,
    });
  }

  /** Cria o registro de `Invoice` a partir de um pagamento aprovado — chamado
   * pelo webhook/confirmação de checkout. */
  async createFromPayment(
    subscriptionId: string,
    paymentId: string,
  ): Promise<void> {
    const [subscription, payment] = await Promise.all([
      this.prisma.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
        include: { user: true },
      }),
      this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }),
    ]);

    const invoiceNumber = this.generateInvoiceNumber();
    const serviceName = `Assinatura ${PLAN_NAMES[subscription.planType]}`;
    const serviceDescription = subscription.billingPeriod
      ? `Plano ${PLAN_NAMES[subscription.planType]} - ${subscription.billingPeriod === 'YEARLY' ? 'Anual' : 'Mensal'}`
      : serviceName;

    await this.prisma.invoice.create({
      data: {
        subscriptionId: subscription.id,
        paymentId: payment.id,
        invoiceNumber,
        amount: payment.amount,
        taxAmount: 0,
        totalAmount: payment.finalAmount,
        status: 'PAID',
        issueDate: new Date(),
        dueDate: payment.createdAt,
        paidAt: payment.paidAt,
        customerName:
          `${subscription.user.firstName ?? ''} ${subscription.user.lastName ?? ''}`.trim() ||
          subscription.user.email ||
          'Cliente',
        customerEmail: subscription.user.email ?? '',
        // CPF/CNPJ do cliente ainda não é coletado em nenhum lugar do produto
        // (placeholder herdado do legado — mesmo "TODO" que já existia lá).
        customerDocument: '000.000.000-00',
        customerCity: subscription.user.city ?? undefined,
        customerState: subscription.user.state ?? undefined,
        description: serviceDescription,
      },
    });
  }

  private generateInvoiceNumber(): string {
    const year = new Date().getFullYear();
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0');
    return `NF-${year}-${timestamp}${random}`;
  }

  private wrapPdfRedirectHtml(pdfUrl: string): string {
    // Só http(s): `javascript:` num refresh é execução de script.
    const safe = /^https?:\/\//i.test(pdfUrl) ? escapeHtml(pdfUrl) : '#';
    return `<!doctype html><html><head><meta http-equiv="refresh" content="0; url=${safe}"></head><body>Redirecionando...</body></html>`;
  }

  private renderInvoiceHtml(data: {
    invoiceNumber: string;
    issueDate: Date;
    dueDate: Date;
    customerName: string;
    customerEmail: string;
    customerDocument: string;
    customerAddress?: string | null;
    customerCity?: string | null;
    customerState?: string | null;
    customerZipCode?: string | null;
    serviceName: string;
    serviceDescription: string;
    amount: number;
    taxAmount: number;
    totalAmount: number;
    companyName: string;
    companyDocument: string;
    companyAddress: string;
    paymentMethod?: string;
    paidAt?: Date;
  }): string {
    const isPaid = !!data.paidAt;

    // Nome, e-mail, cidade e estado vêm do perfil, que a pessoa edita — e o
    // admin abre a nota de qualquer um. Sem escapar, um nome com `<script>`
    // rodava na sessão de quem abrisse a nota.
    const e = (value: string | null | undefined) => escapeHtml(value ?? '');

    return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Nota Fiscal - ${e(data.invoiceNumber)}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; background: #f5f5f5; padding: 20px; }
        .invoice-container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { display: flex; justify-content: space-between; align-items: start; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 3px solid #6366f1; }
        .company-info h1 { font-size: 28px; color: #6366f1; margin-bottom: 5px; }
        .company-info p { font-size: 14px; color: #666; }
        .invoice-info { text-align: right; }
        .invoice-number { font-size: 20px; font-weight: bold; color: #333; margin-bottom: 5px; }
        .invoice-status { display: inline-block; padding: 5px 15px; border-radius: 20px; font-size: 12px; font-weight: bold; text-transform: uppercase; ${isPaid ? 'background: #10b981; color: white;' : 'background: #f59e0b; color: white;'} }
        .dates { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
        .date-box { padding: 15px; background: #f9fafb; border-radius: 6px; }
        .date-box label { font-size: 12px; color: #666; text-transform: uppercase; font-weight: 600; }
        .date-box .value { font-size: 16px; color: #333; margin-top: 5px; }
        .section { margin-bottom: 30px; }
        .section-title { font-size: 14px; font-weight: 600; color: #666; text-transform: uppercase; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #e5e7eb; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
        .info-item { padding: 12px; background: #f9fafb; border-radius: 6px; }
        .info-item label { font-size: 12px; color: #666; display: block; margin-bottom: 5px; }
        .info-item .value { font-size: 14px; color: #333; font-weight: 500; }
        .service-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
        .service-table th { background: #f9fafb; padding: 12px; text-align: left; font-size: 12px; font-weight: 600; color: #666; text-transform: uppercase; border-bottom: 2px solid #e5e7eb; }
        .service-table td { padding: 15px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
        .totals { margin-top: 30px; padding-top: 20px; border-top: 2px solid #e5e7eb; }
        .total-row { display: flex; justify-content: space-between; padding: 10px 0; font-size: 14px; }
        .total-row.final { font-size: 18px; font-weight: bold; color: #6366f1; padding-top: 15px; border-top: 1px solid #e5e7eb; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #666; }
        @media print { body { background: white; padding: 0; } .invoice-container { box-shadow: none; } }
      </style>
    </head>
    <body>
      <div class="invoice-container">
        <div class="header">
          <div class="company-info">
            <h1>${e(data.companyName)}</h1>
            <p>CNPJ: ${e(data.companyDocument)}</p>
            <p>${e(data.companyAddress)}</p>
          </div>
          <div class="invoice-info">
            <div class="invoice-number">${e(data.invoiceNumber)}</div>
            <div class="invoice-status">${isPaid ? 'Pago' : 'Pendente'}</div>
          </div>
        </div>
        <div class="dates">
          <div class="date-box"><label>Data de Emissão</label><div class="value">${data.issueDate.toLocaleDateString('pt-BR')}</div></div>
          <div class="date-box"><label>Data de Vencimento</label><div class="value">${data.dueDate.toLocaleDateString('pt-BR')}</div></div>
        </div>
        <div class="section">
          <div class="section-title">Dados do Cliente</div>
          <div class="info-grid">
            <div class="info-item"><label>Nome</label><div class="value">${e(data.customerName)}</div></div>
            <div class="info-item"><label>CPF/CNPJ</label><div class="value">${e(data.customerDocument)}</div></div>
            <div class="info-item"><label>Email</label><div class="value">${e(data.customerEmail)}</div></div>
            ${
              data.customerAddress
                ? `<div class="info-item"><label>Endereço</label><div class="value">${e(data.customerAddress)}${data.customerCity ? `, ${e(data.customerCity)}` : ''}${data.customerState ? ` - ${e(data.customerState)}` : ''}${data.customerZipCode ? ` - ${e(data.customerZipCode)}` : ''}</div></div>`
                : ''
            }
          </div>
        </div>
        <div class="section">
          <div class="section-title">Serviços</div>
          <table class="service-table">
            <thead><tr><th>Descrição</th><th style="text-align: right;">Valor</th></tr></thead>
            <tbody><tr><td><strong>${e(data.serviceName)}</strong><br><span style="color: #666; font-size: 12px;">${e(data.serviceDescription)}</span></td><td style="text-align: right;">${formatPriceBRL(data.amount)}</td></tr></tbody>
          </table>
        </div>
        <div class="totals">
          <div class="total-row"><span>Subtotal</span><span>${formatPriceBRL(data.amount)}</span></div>
          ${data.taxAmount > 0 ? `<div class="total-row"><span>Impostos</span><span>${formatPriceBRL(data.taxAmount)}</span></div>` : ''}
          <div class="total-row final"><span>Total</span><span>${formatPriceBRL(data.totalAmount)}</span></div>
        </div>
        ${
          isPaid
            ? `<div class="section"><div class="section-title">Informações de Pagamento</div><div class="info-grid"><div class="info-item"><label>Método de Pagamento</label><div class="value">${e(data.paymentMethod || 'N/A')}</div></div><div class="info-item"><label>Data do Pagamento</label><div class="value">${data.paidAt?.toLocaleDateString('pt-BR') || 'N/A'}</div></div></div></div>`
            : ''
        }
        <div class="footer">
          <p>Este documento é uma nota fiscal simplificada gerada eletronicamente.</p>
          <p>Para dúvidas, entre em contato: suporte@opusatlas.com</p>
        </div>
      </div>
    </body>
    </html>`;
  }
}
