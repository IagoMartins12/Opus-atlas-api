import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

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

  @ApiPropertyOptional({
    enum: ['pt', 'en'],
    description: 'O idioma do site no cadastro; os e-mails seguem ele.',
  })
  @IsOptional()
  @IsIn(['pt', 'en'])
  language?: 'pt' | 'en';
}
