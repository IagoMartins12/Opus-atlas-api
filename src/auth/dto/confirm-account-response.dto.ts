import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConfirmAccountResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Email confirmado com sucesso!' })
  message: string;

  @ApiPropertyOptional({
    example: false,
    description: 'true quando o e-mail já havia sido confirmado antes',
  })
  alreadyConfirmed?: boolean;
}
