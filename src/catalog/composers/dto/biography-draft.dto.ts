import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { BioLanguage } from '../composer-bio.service';

/**
 * O que o formulário de cadastro já sabe do compositor, para o rascunho da
 * biografia. Substitui `POST /api/composer/new/biography/generate` do legado.
 */
export class BiographyDraftDto {
  @ApiProperty({ example: 'Villa-Lobos' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: 'Heitor Villa-Lobos' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  alternativeNames?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  birthDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  deathDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  epochName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  roleName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nationality?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  instruments?: string;

  @ApiPropertyOptional({ enum: ['pt', 'en'], default: 'pt' })
  @IsOptional()
  @IsIn(['pt', 'en'])
  language?: BioLanguage;
}

/** Substitui `POST /api/composer/[id]/biography/translate` do legado. */
export class TranslateBiographyDto {
  @ApiProperty({
    description: 'Biografia em português, como está no formulário.',
  })
  @IsString()
  @MinLength(20)
  @MaxLength(20_000)
  text!: string;
}

export class TranslatedBiographyDto {
  @ApiProperty() translatedText!: string;
}

/**
 * A biografia devolvida pelas rotas de biografia.
 *
 * Um formato só para os dois desfechos: o texto pronto (com a origem) ou a
 * ausência explicada — `unavailable` quando a IA não conhece o compositor,
 * `generating` quando ainda está escrevendo e vale perguntar de novo.
 */
export class BiographyResponseDto {
  @ApiProperty({
    nullable: true,
    description: 'Nulo quando não houve texto; aí `status` diz por quê.',
  })
  biography: string | null;

  @ApiProperty({ enum: ['pt', 'en'], example: 'pt' })
  language: string;

  @ApiPropertyOptional({
    enum: ['database', 'generated', 'translated'],
    description: 'De onde o texto veio.',
  })
  source?: string;

  @ApiPropertyOptional({
    nullable: true,
    example: 'anthropic/claude-opus-5',
    description: 'Provedor e modelo, quando o texto saiu da IA.',
  })
  generatedBy?: string | null;

  @ApiPropertyOptional({
    enum: ['unavailable', 'generating'],
    description:
      '`unavailable`: a IA não conhece o compositor, não adianta insistir. ' +
      '`generating`: ainda escrevendo, pergunte de novo.',
  })
  status?: string;

  @ApiPropertyOptional({
    description: 'Segundos até valer a pena perguntar de novo.',
  })
  retryAfter?: number;
}
