import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuthUserDto } from './auth-user.dto';

/**
 * Corpo das respostas que abrem sessão (cadastro, login, renovação).
 *
 * Os tokens viajam nos cookies `httpOnly`. No corpo eles só aparecem fora de
 * produção, para testar pelo Swagger e por `curl` — em produção, devolvê-los
 * aqui entregaria a JavaScript justamente o que o `httpOnly` esconde.
 */
export class AuthResponseDto {
  @ApiPropertyOptional({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'Só fora de produção. Em produção, apenas no cookie.',
  })
  accessToken?: string;

  @ApiPropertyOptional({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'Só fora de produção. Em produção, apenas no cookie.',
  })
  refreshToken?: string;

  @ApiProperty({
    example: 900,
    description: 'Tempo de expiração do access token em segundos',
  })
  expiresIn: number;

  @ApiProperty({ type: AuthUserDto })
  user: AuthUserDto;
}
