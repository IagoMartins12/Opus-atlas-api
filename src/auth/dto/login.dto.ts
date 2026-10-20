import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Sem `@MinLength` de propósito: a regra de tamanho é do cadastro. No login,
 * uma senha curta é só uma senha errada — validar aqui devolvia 400 com
 * "password must be longer than…", que contava a regra a quem tenta adivinhar
 * e aparecia no modal. O teto existe para o hash não receber um texto enorme.
 */
export class LoginDto {
  @ApiProperty({ example: 'aluno@opusatlas.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SenhaForte123!', maxLength: 128 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}
