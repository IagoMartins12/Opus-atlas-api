import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
} from 'class-validator';

const CATEGORIES = [
  'suporte',
  'bug',
  'moderacao',
  'parceria',
  'feedback',
] as const;
const PRIORITIES = ['baixa', 'normal', 'alta', 'urgente'] as const;

export class SubmitContactDto {
  @ApiProperty({ example: 'Maria Silva' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: 'maria@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Dúvida sobre assinatura' })
  @IsString()
  @MinLength(5)
  subject: string;

  @ApiProperty({ example: 'Gostaria de saber como funciona o plano premium.' })
  @IsString()
  @MinLength(10)
  message: string;

  @ApiProperty({ enum: CATEGORIES })
  @IsIn(CATEGORIES)
  category: (typeof CATEGORIES)[number];

  @ApiProperty({ enum: PRIORITIES })
  @IsIn(PRIORITIES)
  priority: (typeof PRIORITIES)[number];

  @ApiPropertyOptional({
    description: 'Se marcado, também inscreve o e-mail na newsletter',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  subscribeNewsletter?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  // Sem exigir domínio de topo: em desenvolvimento a página está em
  // `localhost`, e o legado aceitava qualquer URL.
  @IsUrl({ require_tld: false })
  sourceUrl?: string;
}
