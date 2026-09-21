import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class ScoreWorkComposerDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Chopin' })
  name: string;

  @ApiProperty({ nullable: true })
  fullName: string | null;
}

class ScoreWorkNamedDto {
  @ApiProperty({ example: 'Piano' })
  name: string;
}

class ScoreWorkDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Sonata No. 2 em Si bemol menor' })
  title: string;

  @ApiProperty({ type: ScoreWorkComposerDto })
  composer: ScoreWorkComposerDto;

  @ApiPropertyOptional({ type: ScoreWorkNamedDto })
  epoch?: ScoreWorkNamedDto;

  @ApiPropertyOptional({ type: ScoreWorkNamedDto })
  instrument?: ScoreWorkNamedDto;
}

/**
 * A partitura como o registro e a edição a devolvem. Na edição vem com a obra
 * resolvida — o cabeçalho do formulário mostra obra, compositor e instrumento.
 */
export class ScoreUploadResponseDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  workId: string;

  @ApiProperty({ example: 'Partitura completa (primeira edição)' })
  title: string;

  @ApiProperty({
    example: 'UPLOAD',
    description:
      'De onde veio: `IMSLP`, `UPLOAD` (arquivo hospedado aqui) ou ' +
      '`CUSTOM` (link externo).',
  })
  source: string;

  @ApiProperty({ description: 'Identificador dentro da origem.' })
  sourceId: string;

  @ApiProperty({ description: 'Onde o arquivo é baixado.' })
  downloadUrl: string;

  @ApiProperty({ nullable: true })
  thumbnailUrl: string | null;

  @ApiProperty({ nullable: true })
  publisher: string | null;

  @ApiProperty({ nullable: true })
  editor: string | null;

  @ApiProperty({ nullable: true })
  publicationYear: number | null;

  @ApiProperty({ nullable: true })
  copyright: string | null;

  @ApiProperty({ nullable: true })
  pageCount: number | null;

  @ApiProperty({ nullable: true })
  fileSize: number | null;

  @ApiProperty({ nullable: true })
  groupIndex: number | null;

  @ApiProperty({ nullable: true })
  groupTitle: string | null;

  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4', nullable: true })
  uploadedBy: string | null;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({ type: ScoreWorkDto })
  work?: ScoreWorkDto;
}

class ScoreGroupDto {
  @ApiProperty({ example: 0 })
  groupIndex: number;

  @ApiProperty({ example: 'Partitura Completa' })
  groupTitle: string;

  @ApiProperty({ description: 'Partituras neste grupo.' })
  count: number;

  @ApiProperty({ enum: ['IMSLP', 'USER_UPLOADED'] })
  source: 'IMSLP' | 'USER_UPLOADED';
}

class ScoreGroupSuggestionDto {
  @ApiProperty({ example: 'Partes Individuais' })
  suggestedTitle: string;

  @ApiProperty({ example: 1 })
  suggestedIndex: number;

  @ApiProperty({ description: 'Por que a sugestão apareceu.' })
  reason: string;

  @ApiProperty({ enum: ['high', 'medium'] })
  confidence: 'high' | 'medium';

  @ApiProperty({ enum: ['USER_UPLOADED'] })
  source: 'USER_UPLOADED';
}

class ScoreGroupStatsDto {
  @ApiProperty() totalGroups: number;
  @ApiProperty() imslpGroups: number;
  @ApiProperty() userGroups: number;
  @ApiProperty() otherUsersGroups: number;
  @ApiProperty() totalScores: number;
  @ApiProperty() userScores: number;
  @ApiProperty() imslpScores: number;
  @ApiProperty() otherUsersScores: number;
}

/**
 * Os grupos da obra vistos por quem vai enviar: os do IMSLP, os da própria
 * pessoa e onde a partitura nova encaixaria. Os grupos de outras pessoas não
 * são listados — só contados nas estatísticas.
 */
export class ScoreGroupsResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ type: [ScoreGroupDto], description: 'Grupos do IMSLP.' })
  groups: ScoreGroupDto[];

  @ApiProperty({ type: [ScoreGroupDto], description: 'Grupos de quem pediu.' })
  userGroups: ScoreGroupDto[];

  @ApiProperty({ type: [ScoreGroupSuggestionDto] })
  suggestions: ScoreGroupSuggestionDto[];

  @ApiProperty()
  hasExistingScores: boolean;

  @ApiProperty({ type: ScoreGroupStatsDto })
  stats: ScoreGroupStatsDto;
}
