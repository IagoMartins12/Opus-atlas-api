import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class ComposerWorkInstrumentDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Piano' })
  name: string;
}

export class ComposerWorkItemDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893ff' })
  id: string;

  @ApiProperty({ example: 'Sonata No. 14' })
  title: string;

  @ApiPropertyOptional({ example: 'Quasi una fantasia', nullable: true })
  subtitle?: string;

  @ApiPropertyOptional({ example: 'Op. 27 No. 2', nullable: true })
  opOrCatalog?: string;

  @ApiPropertyOptional({ example: '1801', nullable: true })
  compositionYear?: string;

  @ApiPropertyOptional({ example: 'C♯ minor', nullable: true })
  tone?: string;

  @ApiPropertyOptional({ example: '15:23', nullable: true })
  mediaDuration?: string;

  @ApiProperty({
    example: 'https://imslp.org/wiki/Special:ReverseLookup/123456',
  })
  imslpPermlink: string;

  @ApiPropertyOptional({ nullable: true })
  videoUrl?: string;

  @ApiPropertyOptional({ example: 'I. Adagio sostenuto', nullable: true })
  moviment?: string;

  @ApiPropertyOptional({ type: ComposerWorkInstrumentDto, nullable: true })
  instrument?: ComposerWorkInstrumentDto;

  @ApiProperty({ example: 'INDIVIDUAL' })
  workType: string;

  @ApiPropertyOptional({ type: [String] })
  workGenresArr?: string[];

  @ApiPropertyOptional({ type: [String] })
  categoryNames?: string[];

  @ApiProperty({ example: true })
  isVerified: boolean;

  @ApiPropertyOptional({ example: 'INTERMEDIATE', nullable: true })
  difficultyLevel?: string;

  @ApiPropertyOptional({ type: [String] })
  imslpTags?: string[];
}
