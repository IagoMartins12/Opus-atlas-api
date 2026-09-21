import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class ScrapeComposerDto {
  @ApiProperty({
    example: 'https://pt.wikipedia.org/wiki/Ludwig_van_Beethoven',
    description:
      'Endereço do artigo na Wikipedia, em qualquer idioma. O **host** é ' +
      'conferido contra uma lista fechada e só HTTPS é aceito — a validação ' +
      'do legado era um `includes("wikipedia.org")` sobre a URL inteira, o ' +
      'que deixava passar qualquer endereço que contivesse esse texto.',
  })
  @IsString()
  @MaxLength(2000)
  url!: string;
}
