import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateAnnotationDto } from './create-annotation.dto';

/** Todos os campos de `CreateAnnotationDto` são editáveis, exceto a obra da anotação. */
export class UpdateAnnotationDto extends PartialType(
  OmitType(CreateAnnotationDto, ['workId'] as const),
) {}
