import { OmitType, PartialType } from '@nestjs/swagger';
import { InviteStudentDto } from './invite-student.dto';

/**
 * `studentUserId` fica de fora: trocar o aluno de um vínculo existente
 * transferiria o histórico de aulas e tarefas para outra pessoa.
 */
export class UpdateRelationshipDto extends PartialType(
  OmitType(InviteStudentDto, ['studentUserId'] as const),
) {}
