import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Corpo de `refresh` e `logout` — **opcional**.
 *
 * O navegador manda o refresh token no cookie `httpOnly`; o corpo só serve a
 * cliente sem cookie. Exigido, ele fazia a chamada só com cookie voltar 400
 * antes de o controller chegar a ler o cookie.
 */
export class RefreshTokenDto {
  @ApiPropertyOptional({
    description: 'Refresh token — só para cliente sem cookie',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
