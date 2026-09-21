import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InvoicesService } from './invoices.service';

const OWNER = '64b000000000000000000001';

const invoice = (overrides: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  invoiceNumber: 'NF-2026-000001',
  status: 'PAID',
  amount: 30,
  taxAmount: 0,
  totalAmount: 30,
  issueDate: new Date('2026-09-01T12:00:00Z'),
  dueDate: new Date('2026-09-01T12:00:00Z'),
  paidAt: new Date('2026-09-01T12:00:00Z'),
  customerName: 'Ana',
  customerEmail: 'ana@x.com',
  customerDocument: '000.000.000-00',
  customerAddress: null,
  customerCity: null,
  customerState: null,
  customerZipCode: null,
  description: 'Plano Plus - Mensal',
  pdfUrl: null,
  companyName: 'Opus Atlas',
  companyDocument: '00.000.000/0001-00',
  companyAddress: 'São Paulo',
  subscription: { userId: OWNER, planType: 'PLUS', billingPeriod: 'MONTHLY' },
  payment: {
    paymentMethod: 'CREDIT_CARD',
    status: 'APPROVED',
    paidAt: new Date(),
  },
  ...overrides,
});

describe('InvoicesService', () => {
  let prisma: {
    invoice: { findUnique: jest.Mock; create: jest.Mock };
    subscription: { findUniqueOrThrow: jest.Mock };
    payment: { findUniqueOrThrow: jest.Mock };
  };
  let service: InvoicesService;

  beforeEach(() => {
    prisma = {
      invoice: {
        findUnique: jest.fn().mockResolvedValue(invoice()),
        create: jest.fn().mockResolvedValue({}),
      },
      subscription: { findUniqueOrThrow: jest.fn() },
      payment: { findUniqueOrThrow: jest.fn() },
    };
    service = new InvoicesService(prisma as unknown as PrismaService);
  });

  describe('quem vê a nota', () => {
    it('o dono vê', async () => {
      const detail = await service.getDetail(OWNER, false, 'inv-1');

      expect(detail.invoice.invoiceNumber).toBe('NF-2026-000001');
      expect(detail.subscription.planType).toBe('PLUS');
      expect(detail.payment.status).toBe('APPROVED');
    });

    it('outra pessoa não; admin sim', async () => {
      await expect(
        service.getDetail('outro', false, 'inv-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.getDetail('outro', true, 'inv-1'),
      ).resolves.toBeDefined();
    });

    it('inexistente é 404', async () => {
      prisma.invoice.findUnique.mockResolvedValue(null);

      await expect(service.getDetail(OWNER, false, 'x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('HTML da nota', () => {
    // O admin abre a nota de qualquer um; o nome vem do perfil que a pessoa edita.
    it('escapa o que o cliente escreveu', async () => {
      prisma.invoice.findUnique.mockResolvedValue(
        invoice({
          customerName: '<script>alert(1)</script>',
          customerAddress: 'Rua "A"',
          customerCity: '<b>',
          customerState: 'SP',
          customerZipCode: '01000-000',
        }),
      );

      const html = await service.getHtml(OWNER, true, 'inv-1');

      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).toContain('Rua &quot;A&quot;, &lt;b&gt; - SP - 01000-000');
      expect(html).toContain('Pago');
      expect(html).toContain('Informações de Pagamento');
    });

    it('nota não paga sai como pendente, com imposto quando há', async () => {
      prisma.invoice.findUnique.mockResolvedValue(
        invoice({ paidAt: null, taxAmount: 3, totalAmount: 33 }),
      );

      const html = await service.getHtml(OWNER, false, 'inv-1');

      expect(html).toContain('Pendente');
      expect(html).toContain('Impostos');
      expect(html).not.toContain('Informações de Pagamento');
    });

    it('com PDF, redireciona — só para http(s)', async () => {
      prisma.invoice.findUnique.mockResolvedValue(
        invoice({ pdfUrl: 'https://cdn/nota.pdf' }),
      );
      await expect(service.getHtml(OWNER, false, 'inv-1')).resolves.toContain(
        'url=https://cdn/nota.pdf',
      );

      prisma.invoice.findUnique.mockResolvedValue(
        invoice({ pdfUrl: 'javascript:alert(1)' }),
      );
      const html = await service.getHtml(OWNER, false, 'inv-1');
      expect(html).toContain('url=#');
      expect(html).not.toContain('javascript:');
    });
  });

  describe('emitir a partir do pagamento', () => {
    beforeEach(() => {
      prisma.payment.findUniqueOrThrow.mockResolvedValue({
        id: 'pay-1',
        amount: 300,
        finalAmount: 300,
        createdAt: new Date(),
        paidAt: new Date(),
      });
    });

    it('anual, com nome completo e local do perfil', async () => {
      prisma.subscription.findUniqueOrThrow.mockResolvedValue({
        id: 'sub-1',
        planType: 'MAESTRO',
        billingPeriod: 'YEARLY',
        user: {
          firstName: 'Ana',
          lastName: 'Lima',
          email: 'a@x.com',
          city: 'Recife',
          state: 'PE',
        },
      });

      await service.createFromPayment('sub-1', 'pay-1');

      const [{ data }] = prisma.invoice.create.mock.calls[0];
      expect(data).toMatchObject({
        subscriptionId: 'sub-1',
        paymentId: 'pay-1',
        totalAmount: 300,
        status: 'PAID',
        customerName: 'Ana Lima',
        customerCity: 'Recife',
        description: 'Plano Maestro - Anual',
      });
      expect(data.invoiceNumber).toMatch(/^NF-\d{4}-\d{9}$/);
    });

    it('sem nome usa o e-mail; sem período usa o nome do serviço', async () => {
      prisma.subscription.findUniqueOrThrow.mockResolvedValue({
        id: 'sub-1',
        planType: 'PLUS',
        billingPeriod: null,
        user: {
          firstName: null,
          lastName: null,
          email: null,
          city: null,
          state: null,
        },
      });

      await service.createFromPayment('sub-1', 'pay-1');

      const [{ data }] = prisma.invoice.create.mock.calls[0];
      expect(data.customerName).toBe('Cliente');
      expect(data.customerEmail).toBe('');
      expect(data.description).toBe('Assinatura Plus');
    });
  });
});
