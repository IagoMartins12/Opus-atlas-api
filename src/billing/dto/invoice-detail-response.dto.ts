import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class InvoiceSummaryDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'NF-2026-001234' })
  invoiceNumber: string;

  @ApiProperty({ example: 'PAID' })
  status: string;

  @ApiProperty({ example: 19.9 })
  amount: number;

  @ApiProperty({ example: 0 })
  taxAmount: number;

  @ApiProperty({ example: 19.9 })
  totalAmount: number;

  @ApiProperty({ example: '2026-09-06T12:00:00.000Z' })
  issueDate: Date;

  @ApiProperty({ example: '2026-09-06T12:00:00.000Z' })
  dueDate: Date;

  @ApiPropertyOptional({ nullable: true })
  paidAt?: Date | null;

  @ApiProperty({ example: 'Maria Silva' })
  customerName: string;

  @ApiProperty({ example: 'maria@example.com' })
  customerEmail: string;

  @ApiProperty({ example: 'Assinatura Plus - Mensal' })
  description: string;

  @ApiPropertyOptional({ nullable: true })
  pdfUrl?: string | null;
}

export class InvoiceDetailResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ type: InvoiceSummaryDto })
  invoice: InvoiceSummaryDto;

  @ApiProperty({ type: Object })
  subscription: { planType: string; billingPeriod: string | null };

  @ApiProperty({ type: Object })
  payment: {
    paymentMethod: string | null;
    status: string;
    paidAt: Date | null;
  };
}
