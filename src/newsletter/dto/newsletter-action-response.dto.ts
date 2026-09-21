import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Resposta genérica para ações de newsletter (inscrição, confirmação, cancelamento). */
export class NewsletterActionResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({
    example: 'Inscrição realizada! Verifique seu e-mail para confirmar.',
  })
  message: string;

  @ApiPropertyOptional({
    example: 'PENDING',
    enum: ['PENDING', 'ACTIVE', 'UNSUBSCRIBED', 'RESUBSCRIBED'],
  })
  status?: string;

  @ApiPropertyOptional({ example: 3 })
  remainingAttempts?: number;
}
