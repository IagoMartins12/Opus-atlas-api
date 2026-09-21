import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token recebido por e-mail (válido por 1 hora)' })
  @IsString()
  token: string;

  @ApiProperty({ example: 'SenhaForte123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'SenhaForte123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  confirmPassword: string;
}
