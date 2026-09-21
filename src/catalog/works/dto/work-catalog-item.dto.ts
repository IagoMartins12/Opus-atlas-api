import { ApiProperty } from '@nestjs/swagger';

class WorkCatalogComposerDto {
  @ApiProperty({ example: '665f1c2e4a1b2c3d4e5f6701' })
  id: string;

  @ApiProperty({ example: 'Frédéric Chopin' })
  name: string;

  @ApiProperty({ example: 'Frédéric François Chopin', nullable: true })
  fullName?: string | null;

  @ApiProperty({ example: 'Romantismo', nullable: true })
  epochName: string | null;
}

class WorkCatalogInstrumentDto {
  @ApiProperty({ example: 'Piano' })
  name: string;
}

class WorkCatalogEpochDto {
  @ApiProperty({ example: '665f1c2e4a1b2c3d4e5f6702' })
  id: string;

  @ApiProperty({ example: 'Romantismo' })
  name: string;
}

export class WorkCatalogItemDto {
  @ApiProperty({ example: '665f1c2e4a1b2c3d4e5f6789' })
  id: string;

  @ApiProperty({ example: 'Sonata No. 2 em Si bemol menor' })
  title: string;

  @ApiProperty({ example: 'Marche funèbre', nullable: true, required: false })
  subtitle?: string | null;

  @ApiProperty({ example: 'Op. 35', nullable: true, required: false })
  opOrCatalog?: string;

  @ApiProperty({ example: '1839', nullable: true, required: false })
  compositionYear?: string;

  @ApiProperty({ example: 'B♭ minor', nullable: true, required: false })
  tone?: string;

  @ApiProperty({ example: '24:10', nullable: true, required: false })
  mediaDuration?: string;

  @ApiProperty({ example: 'INDIVIDUAL' })
  workType: string;

  @ApiProperty({ example: true })
  isVerified: boolean;

  @ApiProperty({ type: WorkCatalogEpochDto, required: false, nullable: true })
  epoch?: WorkCatalogEpochDto;

  @ApiProperty({ type: WorkCatalogComposerDto })
  composer: WorkCatalogComposerDto;

  @ApiProperty({ type: WorkCatalogInstrumentDto, nullable: true })
  instrument: WorkCatalogInstrumentDto | null;
}
