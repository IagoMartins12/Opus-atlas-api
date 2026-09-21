import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'aluno@opusatlas.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SenhaForte123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;
}
