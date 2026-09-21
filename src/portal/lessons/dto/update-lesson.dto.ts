import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateLessonDto } from './create-lesson.dto';

/**
 * A recorrência e o aluno ficam de fora: mudar o aluno transferiria o histórico
 * da aula, e alterar a recorrência de uma aula já criada exigiria decidir o que
 * fazer com as ocorrências futuras já existentes. Para remarcar, use `reschedule`.
 */
export class UpdateLessonDto extends PartialType(
  OmitType(CreateLessonDto, [
    'studentId',
    'isRecurring',
    'recurrenceType',
    'recurrenceEnd',
    'scheduledAt',
  ] as const),
) {}
