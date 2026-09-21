import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'aluno@opusatlas.com' })
  @IsEmail()
  email: string;
}
