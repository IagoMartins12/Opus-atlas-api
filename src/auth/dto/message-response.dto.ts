import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Resposta genérica de sucesso para endpoints de auth que não retornam sessão. */
export class MessageResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({
    example:
      'Se este e-mail estiver cadastrado, você receberá um link para redefinir sua senha.',
  })
  message: string;

  @ApiPropertyOptional({ example: 3 })
  remainingAttempts?: number;
}
