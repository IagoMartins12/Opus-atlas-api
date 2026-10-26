import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { OWNER_TYPES, OwnerType } from '../orphan-owners';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
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

export class ListTaskRunsQueryDto {
  @ApiPropertyOptional({
    description: 'Id da tarefa ("tokens.prune", "scraper:osesp")',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  task?: string;

  @ApiPropertyOptional({ enum: ['agendado', 'manual'] })
  @IsOptional()
  @IsIn(['agendado', 'manual'])
  trigger?: 'agendado' | 'manual';

  @ApiPropertyOptional({ enum: ['ok', 'falhou'] })
  @IsOptional()
  @IsIn(['ok', 'falhou'])
  status?: 'ok' | 'falhou';

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/** Os escolhidos, ou tudo antes de uma data (de uma tarefa ou de todas). */
export class DeleteTaskRunsDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsMongoId({ each: true })
  ids?: string[];

  @ApiPropertyOptional({
    description: 'Apaga as execuções que começaram antes desta data',
  })
  @IsOptional()
  @IsDateString()
  before?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  task?: string;
}

export class ListOrphansQueryDto {
  @ApiPropertyOptional({
    description: 'Enviados a partir de (ISO). Sem datas, todos.',
  })
  @IsOptional()
  @IsDateString()
  de?: string;

  @ApiPropertyOptional({ description: 'Enviados até (ISO)' })
  @IsOptional()
  @IsDateString()
  ate?: string;

  @ApiPropertyOptional({
    enum: [...OWNER_TYPES, 'sem-dono', 'video-sem-peca'],
    description:
      'Tipo do dono removido, ou `sem-dono` para os sem dono declarado',
  })
  @IsOptional()
  @IsIn([...OWNER_TYPES, 'sem-dono', 'video-sem-peca'])
  tipo?: OwnerType | 'sem-dono' | 'video-sem-peca';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 40 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class DeleteOrphansDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(200)
  @IsMongoId({ each: true })
  ids!: string[];
}
