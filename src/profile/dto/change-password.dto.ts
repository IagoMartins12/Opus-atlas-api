import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({
    description:
      'Obrigatória se a conta já tem senha (login por e-mail/senha). Se a conta só usa login ' +
      'social, este campo é ignorado — a chamada define a primeira senha da conta.',
  })
  @IsString()
  currentPassword: string;

  @ApiProperty({ example: 'SenhaForte123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
