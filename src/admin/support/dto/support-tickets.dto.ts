import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export const TICKET_STATUSES = ['open', 'answered', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export class ListSupportTicketsQueryDto {
  @ApiPropertyOptional({ enum: [...TICKET_STATUSES, 'all'] })
  @IsOptional()
  @IsIn([...TICKET_STATUSES, 'all'])
  status?: TicketStatus | 'all';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

export class UpdateSupportTicketDto {
  @ApiPropertyOptional({ enum: TICKET_STATUSES })
  @IsOptional()
  @IsIn(TICKET_STATUSES)
  status?: TicketStatus;

  @ApiPropertyOptional({ description: 'Nota interna do atendimento.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
