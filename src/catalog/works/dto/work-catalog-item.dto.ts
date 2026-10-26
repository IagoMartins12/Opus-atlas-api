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

  @ApiProperty({ nullable: true, required: false })
  portraitUrl?: string;
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

  @ApiProperty({
    example: 'Sonata ao Luar',
    nullable: true,
    required: false,
    description: 'O nome por que a obra é conhecida, quando não é o título.',
  })
  popularName?: string | null;

  @ApiProperty({ example: 'Moonlight Sonata', nullable: true, required: false })
  popularNameEn?: string | null;

  @ApiProperty({
    type: [String],
    example: ['Estudo Revolucionário (nº 12)'],
    description: 'As partes famosas da obra, pelo nome que se procura.',
  })
  famousParts?: string[];

  @ApiProperty({ type: [String], example: ['Revolutionary Étude (No.12)'] })
  famousPartsEn?: string[];

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

  @ApiProperty({ description: 'Tem gravação (Spotify, YouTube ou áudio)' })
  hasRecording: boolean;

  @ApiProperty({
    nullable: true,
    required: false,
    description: 'Nível IMSLP 1–12, ou BEGINNER/INTERMEDIATE/ADVANCED',
  })
  difficultyLevel?: string;

  @ApiProperty({ type: WorkCatalogEpochDto, required: false, nullable: true })
  epoch?: WorkCatalogEpochDto;

  @ApiProperty({ type: WorkCatalogComposerDto })
  composer: WorkCatalogComposerDto;

  @ApiProperty({ type: WorkCatalogInstrumentDto, nullable: true })
  instrument: WorkCatalogInstrumentDto | null;
}
