import { ApiProperty } from '@nestjs/swagger';

export class ComposerSummaryDto {
  @ApiProperty({ example: 'Frédéric Chopin' })
  name: string;

  @ApiProperty({ example: 'Frédéric François Chopin', nullable: true })
  fullName: string | null;
}

export class WorkSummaryDto {
  @ApiProperty({ example: '665f1c2e4a1b2c3d4e5f6789' })
  id: string;

  @ApiProperty({ example: 'Sonata No. 2 em Si bemol menor' })
  title: string;

  @ApiProperty({ example: 'Op. 35', nullable: true })
  opOrCatalog: string | null;

  @ApiProperty({ type: ComposerSummaryDto })
  composer: ComposerSummaryDto;

  @ApiProperty({ example: 'Piano' })
  instrumentName: string;

  @ApiProperty({
    example: 12,
    description: 'Total de anotações de usuários nessa obra',
  })
  annotationsCount: number;
}
