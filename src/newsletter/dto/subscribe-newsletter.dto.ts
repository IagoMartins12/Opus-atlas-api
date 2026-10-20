import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEmail, IsIn, IsOptional, IsString } from 'class-validator';

export class SubscribeNewsletterDto {
  @ApiPropertyOptional({
    enum: ['pt', 'en'],
    description:
      'O idioma do site de quem se inscreve; os e-mails seguem ele. Sem isso, vale o do navegador.',
  })
  @IsOptional()
  @IsIn(['pt', 'en'])
  language?: 'pt' | 'en';

  @ApiProperty({ example: 'visitante@example.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: 'Maria' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Silva' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ type: [String], example: ['piano', 'barroco'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  interests?: string[];

  @ApiPropertyOptional({
    enum: ['daily', 'weekly', 'monthly'],
    default: 'weekly',
  })
  @IsOptional()
  @IsIn(['daily', 'weekly', 'monthly'])
  frequency?: string;

  @ApiPropertyOptional({ description: 'De onde veio a inscrição' })
  @IsOptional()
  @IsString()
  sourceUrl?: string;

  @ApiPropertyOptional({ description: 'UTM source para atribuição' })
  @IsOptional()
  @IsString()
  utmSource?: string;
}
