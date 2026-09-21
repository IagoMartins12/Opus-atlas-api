import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Uma denúncia, como fica gravada. */
export class ModerationReportDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ enum: ['composer', 'work', 'score', 'blog-comment'] })
  entityType: string;

  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  entityId: string;

  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  reportedBy: string;

  @ApiProperty({ nullable: true })
  moderatedBy: string | null;

  @ApiProperty({ example: 'copyright' })
  reason: string;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ enum: ['pending', 'approved', 'rejected'] })
  status: string;

  @ApiProperty({ enum: ['low', 'normal', 'high', 'urgent'] })
  priority: string;

  @ApiProperty({ nullable: true })
  category: string | null;

  @ApiProperty({ nullable: true })
  moderationNotes: string | null;

  @ApiProperty({ nullable: true })
  resolution: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ nullable: true })
  resolvedAt: Date | null;
}

/**
 * A denúncia na fila do moderador: além do registro, o rótulo da categoria, o
 * prazo que falta e o conteúdo denunciado resolvido — sem ele a fila seria uma
 * lista de ids.
 */
export class ModerationQueueItemDto extends ModerationReportDto {
  @ApiProperty({ nullable: true, example: 'Direito autoral' })
  categoryLabel: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Horas até o prazo; negativo quando já passou.',
  })
  slaHoursLeft: number | null;

  @ApiProperty({ description: 'Verdadeiro quando o prazo passou.' })
  overdue: boolean;

  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description:
      'O conteúdo denunciado, nos campos de cada tipo (compositor, obra, ' +
      'partitura ou comentário). Nulo quando já foi removido.',
  })
  entity: Record<string, unknown> | null;
}

class ModerationPaginationDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 42 }) total: number;
  @ApiProperty({ example: 3 }) totalPages: number;
}

export class ModerationQueueDto {
  @ApiProperty({ type: [ModerationQueueItemDto] })
  reports: ModerationQueueItemDto[];

  @ApiProperty({ type: ModerationPaginationDto })
  pagination: ModerationPaginationDto;
}

class ModerationPendingDto {
  @ApiProperty() total: number;

  @ApiProperty({ description: 'Pendentes com o prazo já vencido.' })
  overdue: number;

  @ApiProperty({
    example: { urgent: 2, high: 5, normal: 11 },
    additionalProperties: { type: 'number' },
    type: 'object',
  })
  byPriority: Record<string, number>;

  @ApiProperty({
    example: { work: 8, score: 10 },
    additionalProperties: { type: 'number' },
    type: 'object',
  })
  byEntityType: Record<string, number>;
}

class ModerationPeriodDto {
  @ApiProperty({ example: 30 }) days: number;
  @ApiProperty() since: Date;

  @ApiProperty({ description: 'Denúncias abertas no período.' })
  reported: number;

  @ApiProperty({ description: 'Denúncias fechadas no período.' })
  resolved: number;

  @ApiProperty({
    nullable: true,
    description:
      'Horas médias até a resolução. Nulo sem nada resolvido — média de ' +
      'zero itens não é zero hora.',
  })
  avgResolutionHours: number | null;

  @ApiProperty({
    additionalProperties: { type: 'number' },
    type: 'object',
  })
  byCategory: Record<string, number>;
}

export class ModerationStatsDto {
  @ApiProperty()
  generatedAt: Date;

  @ApiProperty({
    example: { pending: 18, approved: 120, rejected: 9 },
    additionalProperties: { type: 'number' },
    type: 'object',
  })
  byStatus: Record<string, number>;

  @ApiProperty({ type: ModerationPendingDto })
  pending: ModerationPendingDto;

  @ApiProperty({ type: ModerationPeriodDto })
  period: ModerationPeriodDto;
}

class BulkOutcomeDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  moderationId: string;

  @ApiProperty({ enum: ['resolved', 'failed'] })
  status: string;

  @ApiPropertyOptional({ description: 'Por que aquela denúncia não fechou.' })
  error?: string;
}

/**
 * O resultado do lote. Uma denúncia que falha não derruba as outras: cada uma
 * vira uma linha, e a tela mostra o que ficou para trás.
 */
export class ModerationBulkResultDto {
  @ApiProperty({ example: 'approve' })
  action: string;

  @ApiProperty()
  requested: number;

  @ApiProperty()
  resolved: number;

  @ApiProperty()
  failed: number;

  @ApiProperty({ type: [BulkOutcomeDto] })
  outcomes: BulkOutcomeDto[];
}
