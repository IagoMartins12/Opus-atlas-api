import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class InstrumentTopComposerDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Chopin' })
  name: string;

  @ApiPropertyOptional({ nullable: true })
  fullName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  portraitUrl?: string | null;

  @ApiProperty({ example: 42 })
  worksCount: number;
}

export class InstrumentStatsResponseDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  instrumentId: string;

  @ApiProperty({ example: 'Piano' })
  instrumentName: string;

  @ApiProperty({ example: 1240 })
  worksCount: number;

  @ApiProperty({ example: 380 })
  usersCount: number;

  @ApiProperty({
    type: [InstrumentTopComposerDto],
    description: 'Top 5 compositores com mais obras para este instrumento',
  })
  topComposers: InstrumentTopComposerDto[];
}
