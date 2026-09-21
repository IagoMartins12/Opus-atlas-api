import { ApiProperty } from '@nestjs/swagger';

class PaymentStatsDto {
  @ApiProperty({ example: 239.7 })
  totalPaid: number;

  @ApiProperty({ example: 6 })
  totalPayments: number;

  @ApiProperty({ example: 5 })
  approvedCount: number;

  @ApiProperty({ example: 0 })
  pendingCount: number;

  @ApiProperty({ example: 1 })
  rejectedCount: number;

  @ApiProperty({ example: 0 })
  refundedCount: number;
}

export class PaymentHistoryResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ type: [Object] })
  payments: unknown[];

  @ApiProperty({
    type: Object,
    description:
      'Pagamentos agrupados por status: approved/pending/rejected/refunded',
  })
  grouped: Record<string, unknown[]>;

  @ApiProperty({ type: PaymentStatsDto })
  stats: PaymentStatsDto;
}
