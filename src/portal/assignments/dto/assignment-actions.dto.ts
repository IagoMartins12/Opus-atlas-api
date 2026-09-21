import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SUBMISSION_KINDS, SubmissionKind } from '../assignment-types';

/**
 * Envio do aluno.
 *
 * O arquivo não sobe por aqui. Ele já foi enviado pelo módulo de uploads —
 * vídeo e áudio por envio direto assinado, imagem e PDF pela API — e chega
 * aqui como `assetId`. O legado fazia o upload dentro do PATCH da tarefa, o
 * que misturava a regra da tarefa com a mecânica do armazenamento e obrigava
 * o vídeo inteiro a atravessar o processo da API.
 */
export class CreateSubmissionDto {
  @ApiProperty({ enum: SUBMISSION_KINDS, example: 'video' })
  @IsIn(SUBMISSION_KINDS)
  kind: SubmissionKind;

  @ApiPropertyOptional({
    example: '6700a1b2c3d4e5f60718293a',
    description: 'Arquivo já confirmado no módulo de uploads.',
  })
  @IsOptional()
  @IsMongoId()
  assetId?: string;

  @ApiPropertyOptional({ description: 'Comentário do aluno sobre o envio.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class CompleteAssignmentDto {
  @ApiPropertyOptional({ description: 'Tempo total dedicado, em minutos.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  actualTime?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  studentNotes?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  studentRating?: number;
}

export class AssignmentFeedbackDto {
  @ApiProperty({ example: 'A articulação melhorou bastante.' })
  @IsString()
  @MinLength(2)
  @MaxLength(5000)
  feedback: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;
}
