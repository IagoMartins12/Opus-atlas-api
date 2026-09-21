import { PartialType } from '@nestjs/swagger';
import { CreateWorkContributionDto } from './create-work-contribution.dto';

export class UpdateWorkContributionDto extends PartialType(
  CreateWorkContributionDto,
) {}
