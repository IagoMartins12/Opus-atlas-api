import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class RunMaintenanceTaskDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'Sem isto, tarefa destrutiva roda em **simulação**: conta o que seria ' +
      'removido e não remove nada.',
  })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean = false;

  @ApiPropertyOptional({
    description:
      'Sobrescreve a retenção padrão da tarefa, em dias. Só vale para as ' +
      'tarefas que têm retenção.',
    minimum: 1,
    maximum: 3650,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  retentionDays?: number;
}

export class SetMaintenanceScheduleDto {
  @ApiProperty({
    example: '0 4 * * *',
    description:
      'Expressão cron de cinco campos, interpretada no fuso America/Sao_Paulo.',
  })
  @IsString()
  @MaxLength(100)
  cron!: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Obrigatório para agendar tarefa destrutiva — sem ele o agendamento ' +
      'rodaria em simulação para sempre, o que não é agendamento nenhum.',
  })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean = false;

  @ApiPropertyOptional({ minimum: 1, maximum: 3650 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  retentionDays?: number;
}

export class ListMaintenanceFailuresDto {
  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
