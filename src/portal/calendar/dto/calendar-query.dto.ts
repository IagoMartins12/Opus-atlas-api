import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { queryBoolean } from '../../../common/utils/query-boolean';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsMongoId,
  IsOptional,
} from 'class-validator';

/**
 * `stats` e `conflicts` chegam como texto na query (`?stats=true`).
 * `@Type(() => Boolean)` converteria `'false'` em `true`, porque toda string
 * não vazia é verdadeira — daí a conversão explícita.
 */
// Da query vem texto, e a conversão implícita do ValidationPipe já teria
// transformado "false" em `true` antes do `@Transform`: lê o valor cru.
const toBoolean = queryBoolean;

export class CalendarQueryDto {
  @ApiPropertyOptional({
    example: '2026-09-01T00:00:00.000Z',
    description: 'Início da janela. Sem valor, usa o começo do mês corrente.',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-09-30T23:59:59.000Z',
    description:
      'Fim da janela. Sem valor, 31 dias após o início. Janela máxima de 366 dias.',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    enum: ['teacher', 'student'],
    description:
      'De qual lado consultar. Sem valor, usa o perfil de professor.',
  })
  @IsOptional()
  @IsIn(['teacher', 'student'])
  as?: 'teacher' | 'student';

  @ApiPropertyOptional({
    description: 'Filtra por um aluno. Só vale para o professor.',
  })
  @IsOptional()
  @IsMongoId()
  studentId?: string;

  @ApiPropertyOptional({
    description: 'Filtra por um professor. Só vale para o aluno.',
  })
  @IsOptional()
  @IsMongoId()
  teacherId?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Inclui o resumo do período na resposta.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  stats?: boolean;

  @ApiPropertyOptional({
    default: false,
    description:
      'Inclui os choques de horário do período. Só faz sentido para o professor.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  conflicts?: boolean;

  @ApiPropertyOptional({
    default: false,
    description:
      'Inclui os horários livres do professor no período (agenda declarada ' +
      'menos bloqueios menos aulas, a partir de agora). Só para o professor.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  freeSlots?: boolean;

  @ApiPropertyOptional({
    default: true,
    description: 'Inclui os prazos de tarefa como eventos do calendário.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeAssignments?: boolean;

  @ApiPropertyOptional({
    default: true,
    description:
      'Inclui as aulas passadas ainda sem status, em `needsAttention`.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeNeedsAttention?: boolean;
}
