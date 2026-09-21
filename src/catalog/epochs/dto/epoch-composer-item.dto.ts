import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EpochComposerItemDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Beethoven' })
  name: string;

  @ApiProperty({ example: 'Ludwig van Beethoven' })
  fullName: string;

  @ApiPropertyOptional({ nullable: true })
  portraitUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  birthDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  deathDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  bio?: string | null;
}
