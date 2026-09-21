import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class FeaturedComposerWorkDto {
  @ApiProperty({ example: '68d6ef3758b5d09465856c02' })
  id: string;

  @ApiProperty({ example: 'Sonata No. 14 "Moonlight"' })
  title: string;

  @ApiProperty({ example: 'Beethoven/Moonlight_Sonata' })
  imslpPermlink: string;
}

export class FeaturedComposerResponseDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Beethoven' })
  name: string;

  @ApiProperty({ example: 'Ludwig van Beethoven' })
  fullName: string;

  @ApiPropertyOptional({ nullable: true })
  birthDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  deathDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  portraitUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  bio?: string | null;

  @ApiPropertyOptional({ nullable: true })
  permLinkImslp?: string | null;

  @ApiPropertyOptional({ nullable: true })
  wikipediaLink?: string | null;

  @ApiProperty({ example: 'Romântico' })
  epochName: string;

  @ApiProperty({ example: true })
  isVerified: boolean;

  @ApiProperty({ type: [FeaturedComposerWorkDto] })
  works: FeaturedComposerWorkDto[];
}
