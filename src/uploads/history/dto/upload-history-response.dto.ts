import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class HistoryUserDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ nullable: true })
  firstName: string | null;

  @ApiProperty({ nullable: true })
  lastName: string | null;

  @ApiProperty({ nullable: true })
  image: string | null;
}

/** Uma linha do histórico: o que a pessoa fez, em que item, e quando. */
export class UploadHistoryEntryDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ enum: ['composer', 'work', 'score'] })
  entityType: string;

  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  entityId: string;

  @ApiProperty({ enum: ['create', 'update', 'delete'] })
  action: string;

  @ApiProperty({
    nullable: true,
    description: 'Campos alterados, do jeito que a tela os exibe.',
    additionalProperties: true,
    type: 'object',
  })
  changes: Record<string, unknown> | null;

  @ApiProperty({ nullable: true })
  reason: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ example: '685d591c1e3db0c5aaa893e4' })
  userId?: string;

  @ApiPropertyOptional({ type: HistoryUserDto })
  user?: HistoryUserDto;
}

class HistoryPaginationDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 137 }) total: number;
  @ApiProperty({ example: 7 }) totalPages: number;
}

export class UploadHistoryListDto {
  @ApiProperty({ type: [UploadHistoryEntryDto] })
  entries: UploadHistoryEntryDto[];

  @ApiProperty({ type: HistoryPaginationDto })
  pagination: HistoryPaginationDto;
}

/**
 * A exportação em JSON. Em CSV a resposta é o arquivo, não este corpo —
 * o formato é escolhido pela query `format`.
 */
export class UploadHistoryExportDto {
  @ApiProperty({ type: [UploadHistoryEntryDto] })
  entries: UploadHistoryEntryDto[];

  @ApiProperty()
  total: number;

  @ApiProperty({
    description:
      'Verdadeiro quando a exportação bateu no teto de 5.000 registros — ' +
      'há mais histórico do que saiu no arquivo.',
  })
  truncated: boolean;
}

/** Quanto a pessoa contribuiu, e de que tipo. */
export class UploadHistoryStatsDto {
  @ApiProperty() total: number;
  @ApiProperty() last7Days: number;
  @ApiProperty() last30Days: number;

  @ApiProperty({
    example: { composer: 3, work: 12, score: 40 },
    additionalProperties: { type: 'number' },
    type: 'object',
  })
  byEntityType: Record<string, number>;

  @ApiProperty({
    example: { create: 40, update: 14, delete: 1 },
    additionalProperties: { type: 'number' },
    type: 'object',
  })
  byAction: Record<string, number>;
}

/**
 * O que a pessoa tem publicado **hoje** — diferente do histórico: apagar uma
 * obra tira do total, mas a linha do envio continua registrada.
 */
export class ContributionTotalsDto {
  @ApiProperty() composers: number;
  @ApiProperty() works: number;
  @ApiProperty() scores: number;
  @ApiProperty() total: number;

  @ApiProperty({
    description: 'Denúncias que a pessoa abriu e seguem abertas.',
  })
  pendingReports: number;
}
