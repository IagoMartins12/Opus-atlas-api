import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class DeleteAccountDto {
  @ApiPropertyOptional({
    description:
      'Obrigatória se a conta tem senha própria (hardening novo em relação ao legado, que ' +
      'excluía a conta sem nenhuma confirmação). Contas só com login social não precisam informar.',
  })
  @IsOptional()
  @IsString()
  currentPassword?: string;
}
