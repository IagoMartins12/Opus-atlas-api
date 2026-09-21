import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  it('agrupa por status e soma só o que foi pago', async () => {
    const payments = [
      { id: '1', status: 'APPROVED', finalAmount: 30 },
      { id: '2', status: 'APPROVED', finalAmount: 20 },
      { id: '3', status: 'PENDING', finalAmount: 99 },
      { id: '4', status: 'REJECTED', finalAmount: 10 },
      { id: '5', status: 'REFUNDED', finalAmount: 30 },
    ];
    const prisma = {
      payment: { findMany: jest.fn().mockResolvedValue(payments) },
    };
    const service = new PaymentsService(prisma as unknown as PrismaService);

    const result = await service.getHistory('u1');

    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { subscription: { userId: 'u1' } } }),
    );
    expect(result.stats).toEqual({
      totalPaid: 50,
      totalPayments: 5,
      approvedCount: 2,
      pendingCount: 1,
      rejectedCount: 1,
      refundedCount: 1,
    });
    expect(
      (result.grouped.pending as Array<{ id: string }>).map((p) => p.id),
    ).toEqual(['3']);
  });
});
