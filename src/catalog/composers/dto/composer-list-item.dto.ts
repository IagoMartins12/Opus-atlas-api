import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class ComposerEpochDto {
  @ApiProperty({ example: 'Romântico' })
  name: string;
}

export class ComposerListItemDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Beethoven' })
  name: string;

  @ApiPropertyOptional({ example: 'Ludwig van Beethoven', nullable: true })
  fullName?: string | null;

  @ApiPropertyOptional({ example: '1770', nullable: true })
  birthDate?: string | null;

  @ApiPropertyOptional({ example: '1827', nullable: true })
  deathDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  portraitUrl?: string | null;

  @ApiPropertyOptional({ example: '685d591c1e3db0c5aaa893e5', nullable: true })
  epochId?: string | null;

  @ApiPropertyOptional({ example: 'Romântico', nullable: true })
  epochName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  bio?: string | null;

  @ApiPropertyOptional({ nullable: true })
  permLinkImslp?: string | null;

  @ApiPropertyOptional({ nullable: true })
  wikipediaLink?: string | null;

  @ApiPropertyOptional({ nullable: true })
  imslpId?: string | null;

  @ApiProperty({ example: true })
  isVerified: boolean;

  @ApiPropertyOptional({ type: ComposerEpochDto, nullable: true })
  epoch?: ComposerEpochDto | null;
}
