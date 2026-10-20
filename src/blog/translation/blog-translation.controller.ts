import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
} from 'class-validator';
import { Curator } from '../../common/auth/curator.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  BlogTranslationService,
  TRANSLATION_LANGUAGES,
  TRANSLATION_LIMITS,
  type TranslationLanguage,
} from './blog-translation.service';

export class TranslateTextsDto {
  @ApiProperty({ type: [String], maxItems: TRANSLATION_LIMITS.texts })
  @IsArray()
  @ArrayMaxSize(TRANSLATION_LIMITS.texts)
  @IsString({ each: true })
  @MaxLength(10_000, { each: true })
  texts!: string[];

  @ApiProperty({ enum: TRANSLATION_LANGUAGES })
  @IsIn(TRANSLATION_LANGUAGES)
  from!: TranslationLanguage;

  @ApiProperty({ enum: TRANSLATION_LANGUAGES })
  @IsIn(TRANSLATION_LANGUAGES)
  to!: TranslationLanguage;
}

export class TranslatedTextsDto {
  @ApiProperty({ type: [String] })
  texts!: string[];
}

@ApiTags('blog-admin')
@ApiBearerAuth('access-token')
// Administrador, ou professor aprovado escrevendo o próprio artigo.
@Roles('USER')
@Curator()
@Controller('blog/admin/translate')
export class BlogTranslationController {
  constructor(private readonly translation: BlogTranslationService) {}

  @Post()
  @ApiOperation({
    summary: 'Traduz textos do blog entre português e inglês',
    description:
      'Devolve a lista na mesma ordem. Não grava nada: a tradução volta ' +
      'para o formulário. Os textos do artigo vão separados da estrutura ' +
      '(ver `BlogTranslationService`).',
  })
  @ApiOkResponse({ type: TranslatedTextsDto })
  async translate(@Body() dto: TranslateTextsDto): Promise<TranslatedTextsDto> {
    return {
      texts: await this.translation.translate(dto.texts, dto.from, dto.to),
    };
  }
}
