import { ApiProperty } from '@nestjs/swagger';

export class WorkFilterOptionItemDto {
  @ApiProperty({ example: '665f1c2e4a1b2c3d4e5f6702' })
  id: string;

  @ApiProperty({ example: 'Romantismo' })
  name: string;

  @ApiProperty({ example: 'Romanticism', required: false, nullable: true })
  originalName?: string | null;
}

export class PopularComposerFilterDto {
  @ApiProperty({ example: '665f1c2e4a1b2c3d4e5f6701' })
  id: string;

  @ApiProperty({ example: 'Chopin' })
  name: string;

  @ApiProperty({ example: 'Frédéric Chopin', required: false, nullable: true })
  fullName?: string | null;

  @ApiProperty({ example: 234, required: false })
  worksCount?: number;
}

export class DifficultyLevelDto {
  @ApiProperty({ example: 'BEGINNER' })
  value: string;

  @ApiProperty({ example: 'Iniciante' })
  label: string;
}
