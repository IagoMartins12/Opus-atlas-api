import { PartialType } from '@nestjs/swagger';
import { CreateComposerContributionDto } from './create-composer-contribution.dto';

/**
 * Todos os campos do cadastro, opcionais. `epochId` e `primaryRoleId` seguem
 * validados quando enviados, então uma edição não consegue apontar para uma
 * época inexistente.
 */
export class UpdateComposerContributionDto extends PartialType(
  CreateComposerContributionDto,
) {}
