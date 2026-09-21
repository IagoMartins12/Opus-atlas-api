import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import {
  IsBoolean,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class TtsRequestDto {
  @ApiProperty()
  @IsMongoId()
  articleId!: string;

  @ApiPropertyOptional({
    example: 'pt-BR-Wavenet-B',
    description:
      'Voz do Google. Sem ela, a padrão do legado (pt-BR-Neural2-A).',
  })
  @IsOptional()
  @Matches(/^pt-BR-[A-Za-z0-9]+-[A-Z]$/, { message: 'voz do Google em pt-BR' })
  voiceName?: string;

  @ApiPropertyOptional({ minimum: 0.25, maximum: 4, default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0.25)
  @Max(4)
  speakingRate?: number;

  @ApiPropertyOptional({
    default: false,
    description: 'Gera de novo. Só administração.',
  })
  @IsOptional()
  @IsBoolean()
  regenerate?: boolean;

  // O front do legado manda o texto que montou na página. Ele é aceito e
  // **ignorado**: o áudio lê o artigo, no servidor — com o texto do cliente,
  // qualquer um trocava o áudio de uma matéria pelo que quisesse.
  @ApiHideProperty()
  @IsOptional()
  @IsString()
  @MaxLength(500_000)
  text?: string;
}

export class DeleteTtsDto {
  @ApiProperty()
  @IsMongoId()
  articleId!: string;
}
