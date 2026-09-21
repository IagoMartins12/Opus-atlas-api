import { ApiProperty } from '@nestjs/swagger';

export class ComposerWorkTypeCountsResponseDto {
  @ApiProperty({
    description: 'Contagem de obras por `workType` do compositor',
    example: { INDIVIDUAL: 280, COLLECTION: 12, ARRANGEMENT: 4 },
  })
  workTypeCounts: Record<string, number>;

  @ApiProperty({ example: 3 })
  totalTypes: number;
}
