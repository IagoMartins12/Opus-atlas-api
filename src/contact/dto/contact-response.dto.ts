import { ApiProperty } from '@nestjs/swagger';

export class ContactResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({
    example: 'Mensagem enviada com sucesso! Responderemos em breve.',
  })
  message: string;

  @ApiProperty({ example: 'CH-LXQZ9K-A1B2' })
  ticketId: string;
}
