import { ApiProperty } from '@nestjs/swagger';

class CatalogCandidateDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Bach' })
  name: string;
}

class ScrapedSourcesDto {
  @ApiProperty({ description: 'O artigo de onde veio a prosa.' })
  wikipedia: string;

  @ApiProperty({
    nullable: true,
    description: 'A entidade de onde vieram as datas.',
  })
  wikidata: string | null;
}

/**
 * A ficha de um compositor lida na Wikipedia. **Nada é gravado**: quem decide
 * o que virar cadastro é o formulário de envio, com revisão.
 *
 * As datas vêm do Wikidata, não da prosa: de lá elas trazem a precisão
 * declarada e o calendário — o nascimento de Bach é 21 de março de 1685 no
 * juliano e 31 no gregoriano, e ler do texto é ficar com a que o autor do
 * artigo escolheu.
 */
export class ScrapedComposerDto {
  @ApiProperty({
    example: 'Bach',
    description: 'Sobrenome, como o catálogo guarda.',
  })
  name: string;

  @ApiProperty({ example: 'Johann Sebastian Bach' })
  fullName: string;

  @ApiProperty({ nullable: true, example: '1685-03-21 (juliano)' })
  birthDate: string | null;

  @ApiProperty({ nullable: true }) deathDate: string | null;
  @ApiProperty({ nullable: true }) portraitUrl: string | null;
  @ApiProperty({ nullable: true }) bio: string | null;
  @ApiProperty({ nullable: true }) nationality: string | null;
  @ApiProperty() wikipediaLink: string;

  @ApiProperty({
    description: 'Sugerida pelo ano de nascimento; quem confirma é gente.',
  })
  epochName: string;

  @ApiProperty({
    nullable: true,
    description: 'Id no catálogo, quando o compositor já existe aqui.',
  })
  composerId: string | null;

  @ApiProperty({
    type: [CatalogCandidateDto],
    description: 'Candidatos, quando a busca não foi conclusiva.',
  })
  composerCandidates: CatalogCandidateDto[];

  @ApiProperty({
    type: ScrapedSourcesDto,
    description:
      'De onde veio cada metade, para quem revisa saber no que confiar.',
  })
  sources: ScrapedSourcesDto;

  @ApiProperty({
    example: 90,
    description: 'Quanto da ficha veio, de 0 a 100.',
  })
  dataCompleteness: number;
}
