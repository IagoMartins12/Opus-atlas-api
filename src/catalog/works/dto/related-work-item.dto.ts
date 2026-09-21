import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class RelatedWorkComposerDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Beethoven' })
  name: string;

  @ApiPropertyOptional({ nullable: true })
  epochName?: string | null;
}

class RelatedWorkInstrumentDto {
  @ApiProperty({ example: 'Piano' })
  name: string;
}

export class RelatedWorkItemDto {
  @ApiProperty({ example: '68d6ef3758b5d09465856c02' })
  id: string;

  @ApiProperty({ example: 'Sonata No. 8 "Pathétique"' })
  title: string;

  @ApiPropertyOptional({ nullable: true })
  opOrCatalog?: string | null;

  @ApiPropertyOptional({ nullable: true })
  compositionYear?: string | null;

  @ApiPropertyOptional({ nullable: true })
  tone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  mediaDuration?: string | null;

  @ApiProperty({ example: 'INDIVIDUAL' })
  workType: string;

  @ApiProperty({ type: RelatedWorkComposerDto })
  composer: RelatedWorkComposerDto;

  @ApiPropertyOptional({ type: RelatedWorkInstrumentDto, nullable: true })
  instrument?: RelatedWorkInstrumentDto | null;
}
