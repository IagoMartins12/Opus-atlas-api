import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, Length, ValidateIf } from 'class-validator';

/**
 * Quem pede o reenvio: pelo e-mail, ou pelo token de um link de confirmação
 * já enviado — vencido ou não. O token é o que a página do link conhece de
 * quem ainda não entrou; o e-mail, o que o banner do usuário logado conhece.
 */
export class ResendConfirmationDto {
  @ApiPropertyOptional({
    example: 'aluno@opusatlas.com',
    description: 'E-mail da conta. Obrigatório quando não vem `token`.',
  })
  @ValidateIf((dto: ResendConfirmationDto) => dto.token === undefined)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description:
      'Token de um link de confirmação já enviado, mesmo vencido. Obrigatório quando não vem `email`.',
  })
  @ValidateIf((dto: ResendConfirmationDto) => dto.email === undefined)
  @IsString()
  @Length(16, 256)
  token?: string;
}
