import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

/**
 * **Renomeada.** Chamava-se `ResendNewsletterConfirmationDto`, o mesmo nome da classe em
 * `auth/dto/resend-confirmation.dto.ts` — e o registro de schemas do Swagger é por nome,
 * então uma sobrescrevia a outra no contrato: quem gerava cliente recebia os
 * campos da errada.
 */
export class ResendNewsletterConfirmationDto {
  @ApiProperty({ example: 'visitante@example.com' })
  @IsEmail()
  email: string;
}
