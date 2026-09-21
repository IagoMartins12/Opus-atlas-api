import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

export class UnsubscribeNewsletterDto {
  @ApiPropertyOptional({
    description: 'Token de unsubscribe recebido por e-mail',
  })
  @IsOptional()
  @IsString()
  token?: string;

  @ApiPropertyOptional({ description: 'E-mail (alternativa ao token)' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'too_many_emails' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  feedback?: string;
}
