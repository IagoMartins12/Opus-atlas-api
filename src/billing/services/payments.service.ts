import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentHistoryResponseDto } from '../dto/payment-history-response.dto';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async getHistory(userId: string): Promise<PaymentHistoryResponseDto> {
    const payments = await this.prisma.payment.findMany({
      where: { subscription: { userId } },
      include: {
        subscription: { select: { planType: true, billingPeriod: true } },
        invoice: {
          select: { id: true, invoiceNumber: true, status: true, pdfUrl: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const grouped = {
      approved: payments.filter((payment) => payment.status === 'APPROVED'),
      pending: payments.filter((payment) => payment.status === 'PENDING'),
      rejected: payments.filter((payment) => payment.status === 'REJECTED'),
      refunded: payments.filter((payment) => payment.status === 'REFUNDED'),
    };

    return {
      success: true,
      payments,
      grouped,
      stats: {
        totalPaid: grouped.approved.reduce((sum, p) => sum + p.finalAmount, 0),
        totalPayments: payments.length,
        approvedCount: grouped.approved.length,
        pendingCount: grouped.pending.length,
        rejectedCount: grouped.rejected.length,
        refundedCount: grouped.refunded.length,
      },
    };
  }
}
