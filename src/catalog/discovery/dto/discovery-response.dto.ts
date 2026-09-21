import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class DiscoveryComposerDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Pérotin' })
  name: string;

  @ApiPropertyOptional({ nullable: true })
  fullName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  portraitUrl?: string | null;

  @ApiProperty({ example: 'Medieval' })
  epochName: string;
}

class DiscoveryWorkComposerDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Pérotin' })
  name: string;

  @ApiPropertyOptional({ nullable: true })
  fullName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  portraitUrl?: string | null;
}

class DiscoveryWorkDto {
  @ApiProperty({ example: '68d6ef3758b5d09465856c02' })
  id: string;

  @ApiProperty({ example: 'Viderunt omnes' })
  title: string;

  @ApiPropertyOptional({ nullable: true })
  imslpPermlink?: string | null;

  @ApiPropertyOptional({ nullable: true })
  opOrCatalog?: string | null;

  @ApiPropertyOptional({ nullable: true })
  tone?: string | null;

  @ApiProperty({ type: DiscoveryWorkComposerDto })
  composer: DiscoveryWorkComposerDto;

  @ApiProperty({ example: 'Medieval' })
  epochName: string;

  @ApiProperty({ example: 'Órgão' })
  instrumentName: string;
}

export class DiscoveryResponseDto {
  @ApiProperty({ type: [DiscoveryComposerDto] })
  composers: DiscoveryComposerDto[];

  @ApiProperty({ type: [DiscoveryWorkDto] })
  works: DiscoveryWorkDto[];
}
