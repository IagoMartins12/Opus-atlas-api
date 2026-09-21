import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class AdminUploadUserDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ nullable: true }) firstName: string | null;
  @ApiProperty({ nullable: true }) lastName: string | null;
  @ApiProperty({ nullable: true }) image: string | null;
}

/**
 * Uma contribuição no painel, com o item citado já resolvido — o painel não
 * dispara uma consulta por linha.
 */
export class AdminUploadEntryDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ enum: ['composer', 'work', 'score'] })
  entityType: string;

  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  entityId: string;

  @ApiProperty({ enum: ['create', 'update', 'delete'] })
  action: string;

  @ApiProperty({ nullable: true })
  reason: string | null;

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  changes: Record<string, unknown> | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: AdminUploadUserDto })
  user: AdminUploadUserDto;

  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description:
      'O compositor, a obra ou a partitura citada. Nulo quando o item já ' +
      'foi removido.',
  })
  entity: Record<string, unknown> | null;

  @ApiProperty({
    description:
      'Falso quando o item saiu do catálogo — a linha continua no ' +
      'histórico, porque ela é o registro de que a remoção aconteceu.',
  })
  entityExists: boolean;
}

class AdminUploadsPaginationDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 25 }) limit: number;

  @ApiProperty({
    nullable: true,
    description: 'Nulo na rolagem por cursor: aí a base não é contada de novo.',
  })
  total: number | null;

  @ApiProperty({ nullable: true })
  totalPages: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Id do último item; nulo quando a lista acabou.',
  })
  nextCursor: string | null;
}

export class AdminUploadsListDto {
  @ApiProperty({ type: [AdminUploadEntryDto] })
  entries: AdminUploadEntryDto[];

  @ApiProperty({ type: AdminUploadsPaginationDto })
  pagination: AdminUploadsPaginationDto;
}

class UploadTimelinePointDto {
  @ApiProperty() date: Date;
  @ApiProperty() total: number;
  @ApiProperty() creates: number;
  @ApiProperty() updates: number;
  @ApiProperty() deletes: number;
}

export class AdminUploadStatsDto {
  @ApiProperty({ description: 'Contribuições no período.' })
  total: number;

  @ApiProperty({
    example: { create: 40, update: 14, delete: 1 },
    additionalProperties: { type: 'number' },
    type: 'object',
  })
  byAction: Record<string, number>;

  @ApiProperty({
    example: { composer: 3, work: 12, score: 40 },
    additionalProperties: { type: 'number' },
    type: 'object',
  })
  byEntityType: Record<string, number>;

  @ApiProperty({
    type: [UploadTimelinePointDto],
    description: 'Um ponto por dia do período, inclusive os dias sem nada.',
  })
  timeline: UploadTimelinePointDto[];
}

export class TopContributorDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  userId: string;

  @ApiProperty({ nullable: true, example: 'Ana Costa' })
  name: string | null;

  @ApiPropertyOptional({ nullable: true })
  image: string | null;

  @ApiProperty()
  contributions: number;
}
