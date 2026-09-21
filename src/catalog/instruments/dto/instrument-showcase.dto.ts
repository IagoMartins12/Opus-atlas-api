import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ShowcaseComposerDto {
  @ApiProperty({ example: '685d8f9a8803000f9b61d151' })
  id: string;

  @ApiProperty({ example: 'Bach' })
  name: string;

  @ApiPropertyOptional({ example: 'Johann Sebastian Bach', nullable: true })
  fullName: string | null;

  @ApiPropertyOptional({ nullable: true })
  portraitUrl: string | null;

  @ApiPropertyOptional({ example: 'Barroco', nullable: true })
  epochName: string | null;
}

export class ShowcaseWorkDto {
  @ApiProperty({ example: '686024890b6936a3c6cf444c' })
  id: string;

  @ApiProperty({ example: 'Suite No. 1 in G major' })
  title: string;

  @ApiPropertyOptional({ nullable: true })
  opOrCatalog: string | null;

  @ApiPropertyOptional({ nullable: true })
  compositionYear: string | null;

  @ApiPropertyOptional({ nullable: true })
  tone: string | null;

  @ApiPropertyOptional({ nullable: true })
  mediaDuration: string | null;

  @ApiProperty()
  imslpPermlink: string;

  @ApiPropertyOptional({ nullable: true })
  videoUrl: string | null;

  @ApiProperty({ type: ShowcaseComposerDto })
  composer: ShowcaseComposerDto;
}

export class ShowcaseTopComposerDto {
  @ApiProperty({ type: ShowcaseComposerDto })
  composer: ShowcaseComposerDto;

  @ApiProperty({ example: 42, description: 'Obras dele para o instrumento' })
  count: number;
}

export class InstrumentShowcaseItemDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Piano' })
  name: string;

  @ApiProperty({
    type: [ShowcaseWorkDto],
    description: 'Até 20 obras, pela curadoria do instrumento',
  })
  works: ShowcaseWorkDto[];

  @ApiProperty({ example: 1240 })
  totalWorks: number;

  @ApiProperty({
    example: 380,
    description: 'Usuários que estudam o instrumento',
  })
  totalUsers: number;

  @ApiProperty({
    type: [ShowcaseTopComposerDto],
    description:
      'O compositor em destaque do instrumento, se houver; senão os 5 com mais obras',
  })
  topComposers: ShowcaseTopComposerDto[];
}
