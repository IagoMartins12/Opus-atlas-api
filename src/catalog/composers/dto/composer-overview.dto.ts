import { ApiProperty } from '@nestjs/swagger';

export class WrittenForDto {
  @ApiProperty({ example: '685d…' }) instrumentId: string;
  @ApiProperty({ example: 'Piano' }) name: string;
  @ApiProperty({ example: 158 }) works: number;
}

export class StartingPointDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true, type: String }) opOrCatalog: string | null;
  @ApiProperty({ nullable: true, type: String }) instrumentName: string | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'IMSLP difficulty, 1 (easiest) to 12',
  })
  difficulty: number | null;
  @ApiProperty({ description: 'People who want to learn it' })
  studying: number;
  @ApiProperty({ description: 'People who already learned it' })
  learned: number;
  @ApiProperty({ description: 'Chosen by the team, not by the numbers' })
  curated: boolean;
}

export class ContemporaryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ nullable: true, type: String }) portraitUrl: string | null;
  @ApiProperty({ nullable: true, type: Number }) birthYear: number | null;
  @ApiProperty({ nullable: true, type: Number }) deathYear: number | null;
}

export class ComposerOverviewDto {
  @ApiProperty({ type: [WrittenForDto], description: 'Top instrumentations' })
  writtenFor: WrittenForDto[];
  @ApiProperty({
    type: [StartingPointDto],
    description: 'Most studied works first, then easiest first',
  })
  startingPoints: StartingPointDto[];
  @ApiProperty({
    type: [ContemporaryDto],
    description: 'Random composers alive at the same time (reshuffled hourly)',
  })
  contemporaries: ContemporaryDto[];
}
