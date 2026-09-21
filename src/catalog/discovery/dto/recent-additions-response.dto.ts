import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class RecentComposerDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Arvo Pärt' })
  name: string;

  @ApiPropertyOptional({ nullable: true })
  fullName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  portraitUrl?: string | null;

  @ApiProperty({ example: '2026-09-01T12:00:00.000Z' })
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true })
  epochName?: string | null;
}

class RecentWorkDto {
  @ApiProperty({ example: '68d6ef3758b5d09465856c02' })
  id: string;

  @ApiProperty({ example: 'Tabula Rasa' })
  title: string;

  @ApiPropertyOptional({ nullable: true })
  mediaDuration?: string | null;

  @ApiProperty({ example: '2026-09-01T12:00:00.000Z' })
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true })
  composerFullName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  instrumentName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  epochName?: string | null;
}

export class RecentAdditionsResponseDto {
  @ApiProperty({ type: [RecentComposerDto] })
  composers: RecentComposerDto[];

  @ApiProperty({ type: [RecentWorkDto] })
  works: RecentWorkDto[];
}
