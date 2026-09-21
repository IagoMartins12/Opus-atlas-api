import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'aluno@opusatlas.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SenhaForte123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({ example: 'Maria' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Silva' })
  @IsOptional()
  @IsString()
  lastName?: string;
}
