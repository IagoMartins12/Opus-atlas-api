import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Mais do que isto numa semana não é agenda, é erro de quem montou a tela. */
export const MAX_WEEKLY_SLOTS = 50;

export class WeeklySlotDto {
  @ApiProperty({
    minimum: 0,
    maximum: 6,
    description: '0 = domingo … 6 = sábado',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  @ApiProperty({
    example: '08:00',
    description: 'Hora local, no fuso do professor',
  })
  @Matches(HHMM, { message: 'startTime no formato HH:mm' })
  startTime: string;

  @ApiProperty({ example: '12:00' })
  @Matches(HHMM, { message: 'endTime no formato HH:mm' })
  endTime: string;
}

export class ReplaceAvailabilityDto {
  @ApiProperty({
    type: [WeeklySlotDto],
    description:
      'A agenda semanal inteira — substitui a anterior. Lista vazia apaga a agenda.',
  })
  @IsArray()
  @ArrayMaxSize(MAX_WEEKLY_SLOTS)
  @ValidateNested({ each: true })
  @Type(() => WeeklySlotDto)
  slots: WeeklySlotDto[];

  @ApiPropertyOptional({
    example: 'America/Manaus',
    description: 'Fuso IANA do professor. Ausente, fica o atual.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

export class CreateAvailabilityBlockDto {
  @ApiProperty({ example: '2026-12-20T03:00:00.000Z' })
  @IsDateString()
  startsAt: string;

  @ApiProperty({ example: '2027-01-05T03:00:00.000Z' })
  @IsDateString()
  endsAt: string;

  @ApiPropertyOptional({ example: 'Férias' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class FreeSlotsQueryDto {
  @ApiProperty({ example: '2026-09-14T00:00:00.000Z' })
  @IsDateString()
  from: string;

  @ApiProperty({ example: '2026-09-21T00:00:00.000Z' })
  @IsDateString()
  to: string;

  @ApiPropertyOptional({
    default: 30,
    description: 'Sobras menores que isto (em minutos) não são oferecidas.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(480)
  minMinutes?: number;
}

/**
 * O esquema de aulas do professor (04/10/2026) — a régua do motor de agenda.
 * Tudo opcional: o PATCH muda só o que veio.
 */
export class SchedulingSettingsDto {
  @ApiPropertyOptional({
    example: 60,
    description: 'Duração padrão de uma aula, em minutos.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(240)
  defaultLessonDuration?: number;

  @ApiPropertyOptional({
    example: 15,
    description: 'Folga mínima entre duas aulas.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  bufferMinutes?: number;

  @ApiPropertyOptional({
    example: 40,
    description: 'Tempo para ir de um lugar físico a outro.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(240)
  travelMinutes?: number;

  @ApiPropertyOptional({
    example: 6,
    nullable: true,
    description: 'Sem valor: sem limite.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  maxLessonsPerDay?: number | null;

  @ApiPropertyOptional({ example: 25, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  maxLessonsPerWeek?: number | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  acceptsLessonRequests?: boolean;

  @ApiPropertyOptional({
    example: 12,
    description: 'Antecedência mínima de um pedido de aula, em horas.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(168)
  requestLeadHours?: number;

  @ApiPropertyOptional({
    example: 45,
    description: 'Até quantos dias à frente o aluno pode pedir.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(180)
  requestHorizonDays?: number;

  @ApiPropertyOptional({
    type: [Number],
    example: [1440, 30],
    description: 'Lembretes, em minutos antes da aula.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(5, { each: true })
  @Max(10080, { each: true })
  lessonReminderMinutes?: number[];
}
